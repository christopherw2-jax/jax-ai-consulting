// netlify/functions/ai-assessment.js
exports.handler = async (event, context) => {
  // Handle CORS
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  // Handle preflight requests
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: '',
    };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  try {
    // Debug logging
    console.log('Environment variables check:');
    console.log('OPENAI_API_KEY exists:', !!process.env.OPENAI_API_KEY);
    console.log('API key prefix:', process.env.OPENAI_API_KEY ? process.env.OPENAI_API_KEY.substring(0, 7) : 'undefined');

    const apiKey = process.env.OPENAI_API_KEY;
    
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY environment variable is not set');
    }

    if (!apiKey.startsWith('sk-')) {
      throw new Error('Invalid API key format - should start with sk-');
    }

    const requestData = JSON.parse(event.body);
    const { messages, systemPrompt, maxTokens = 300, assessmentData, isConsultationRequest } = requestData;

    // Handle consultation requests (webhook submission)
    if (isConsultationRequest && assessmentData) {
      console.log('Processing consultation request...');
      await sendToWebhook(assessmentData);
      
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ 
          success: true, 
          message: 'Assessment data sent successfully' 
        }),
      };
    }

    // Handle regular AI conversation with ChatGPT
    console.log('Making request to OpenAI API...');

    // Convert messages format for OpenAI (they use different structure than Claude)
    const openAIMessages = [
      {
        role: 'system',
        content: systemPrompt
      },
      ...messages.map(msg => ({
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content: msg.content
      }))
    ];

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o', // Using GPT-4o for best reasoning capabilities
        messages: openAIMessages,
        max_tokens: maxTokens,
        temperature: 0.7, // Balanced creativity for business conversations
        presence_penalty: 0.1, // Slight penalty to avoid repetition
        frequency_penalty: 0.1 // Slight penalty to keep conversations fresh
      })
    });

    console.log('OpenAI API response status:', response.status);

    if (!response.ok) {
      const errorData = await response.json();
      console.error('OpenAI API error:', errorData);
      throw new Error(`API request failed: ${response.status} - ${JSON.stringify(errorData)}`);
    }

    const data = await response.json();
    console.log('Success! Response received from OpenAI');
    
    // Convert OpenAI response format to match what your frontend expects (Claude format)
    const claudeFormatResponse = {
      content: [{
        text: data.choices[0].message.content
      }],
      usage: data.usage // Include usage stats for monitoring
    };
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(claudeFormatResponse),
    };

  } catch (error) {
    console.error('Function error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Internal server error',
        details: error.message 
      }),
    };
  }
};

// Webhook function to send assessment data (unchanged)
async function sendToWebhook(assessmentData) {
  const webhookUrl = process.env.ZAPIER_WEBHOOK_URL; // We'll set this in Netlify env vars
  
  if (!webhookUrl) {
    console.log('No webhook URL configured, skipping webhook send');
    return;
  }

  try {
    console.log('Sending data to webhook:', webhookUrl);
    
    const webhookPayload = {
      timestamp: new Date().toISOString(),
      source: 'JAX AI Assessment',
      // Individual contact fields for easier mapping
      contactName: assessmentData.contactName,
      businessName: assessmentData.businessName,
      contactEmail: assessmentData.contactEmail,
      contactPhone: assessmentData.contactPhone,
      // Business data
      businessType: assessmentData.businessData.business_type,
      painPoints: assessmentData.businessData.pain_points,
      currentSolution: assessmentData.businessData.current_solution,
      timeSavings: assessmentData.businessData.time_savings,
      timeValue: assessmentData.businessData.time_value,
      // Meta data
      lead_score: assessmentData.leadScore,
      conversation_summary: assessmentData.conversationHistory,
      solution_proposal: assessmentData.solutionProposal,
      consultation_requested: true,
      // Add cost tracking
      ai_provider: 'OpenAI',
      tokens_used: assessmentData.tokensUsed || 0
    };

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(webhookPayload)
    });

    if (response.ok) {
      console.log('Webhook sent successfully');
    } else {
      console.error('Webhook failed:', response.status, await response.text());
    }
  } catch (error) {
    console.error('Webhook error:', error);
  }
}

// Enhanced lead scoring for ChatGPT's better reasoning
function calculateLeadScore(businessData) {
  let score = 0;
  
  // Base score for completing assessment
  score += 25;
  
  // Enhanced scoring using ChatGPT's better logic
  const timeValue = extractTimeValue(businessData.time_value);
  const timeSavings = extractTimeSavings(businessData.time_savings);
  
  // Time value scoring (more granular)
  if (timeValue >= 200) score += 40;
  else if (timeValue >= 100) score += 30;
  else if (timeValue >= 75) score += 25;
  else if (timeValue >= 50) score += 20;
  else if (timeValue >= 25) score += 10;
  
  // Time savings potential (more granular)
  if (timeSavings >= 15) score += 35;
  else if (timeSavings >= 10) score += 25;
  else if (timeSavings >= 5) score += 15;
  else if (timeSavings >= 2) score += 10;
  
  // Business type scoring (some are better fits)
  const businessType = (businessData.business_type || '').toLowerCase();
  if (businessType.includes('salon') || businessType.includes('spa') || 
      businessType.includes('clinic') || businessType.includes('dental') ||
      businessType.includes('medical') || businessType.includes('appointment')) {
    score += 15; // High-automation potential businesses
  } else if (businessType.includes('retail') || businessType.includes('restaurant') ||
             businessType.includes('service')) {
    score += 10; // Medium-automation potential
  }
  
  // Pain points analysis
  const painPoints = (businessData.pain_points || '').toLowerCase();
  if (painPoints.includes('manual') || painPoints.includes('scheduling') ||
      painPoints.includes('reminder') || painPoints.includes('follow')) {
    score += 15; // Direct automation opportunities
  }
  
  // Current solution analysis
  const currentSolution = (businessData.current_solution || '').toLowerCase();
  if (currentSolution.includes('manual') || currentSolution.includes('nothing') ||
      currentSolution.includes('spreadsheet') || currentSolution.includes('excel')) {
    score += 10; // Easy to improve from manual processes
  }
  
  // Quality of responses (length indicates engagement)
  if (businessData.pain_points && businessData.pain_points.length > 100) {
    score += 10; // Detailed, engaged responses
  }
  
  return Math.min(score, 100); // Cap at 100
}

function extractTimeValue(timeValueText) {
  if (!timeValueText) return 0;
  // More sophisticated extraction
  const matches = timeValueText.match(/\$?(\d+(?:,\d{3})*(?:\.\d{2})?)/);
  return matches ? parseFloat(matches[1].replace(/,/g, '')) : 0;
}

function extractTimeSavings(timeSavingsText) {
  if (!timeSavingsText) return 0;
  // Look for various time expressions
  const hourMatches = timeSavingsText.match(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?)/i);
  if (hourMatches) return parseFloat(hourMatches[1]);
  
  const numberMatches = timeSavingsText.match(/(\d+(?:\.\d+)?)/);
  return numberMatches ? parseFloat(numberMatches[1]) : 0;
}
