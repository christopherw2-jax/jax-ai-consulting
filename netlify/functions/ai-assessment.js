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
    console.log('ANTHROPIC_API_KEY exists:', !!process.env.ANTHROPIC_API_KEY);
    console.log('API key prefix:', process.env.ANTHROPIC_API_KEY ? process.env.ANTHROPIC_API_KEY.substring(0, 7) : 'undefined');

    const apiKey = process.env.ANTHROPIC_API_KEY;
    
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY environment variable is not set');
    }

    if (!apiKey.startsWith('sk-ant-')) {
      throw new Error('Invalid API key format - should start with sk-ant-');
    }

    const requestData = JSON.parse(event.body);
    const { messages, systemPrompt, maxTokens = 200, assessmentData, isConsultationRequest } = requestData;

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

    // Handle regular AI conversation
    console.log('Making request to Anthropic API...');

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: messages
      })
    });

    console.log('Anthropic API response status:', response.status);

    if (!response.ok) {
      const errorData = await response.json();
      console.error('Anthropic API error:', errorData);
      throw new Error(`API request failed: ${response.status} - ${JSON.stringify(errorData)}`);
    }

    const data = await response.json();
    console.log('Success! Response received from Anthropic');
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(data),
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

// Webhook function to send assessment data
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
      consultation_requested: true
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

// Calculate lead score based on assessment data
function calculateLeadScore(businessData) {
  let score = 0;
  
  // Base score for completing assessment
  score += 25;
  
  // Scoring based on time value
  const timeValue = extractTimeValue(businessData.time_value);
  if (timeValue >= 100) score += 30;
  else if (timeValue >= 50) score += 20;
  else if (timeValue >= 25) score += 10;
  
  // Scoring based on time savings potential
  const timeSavings = extractTimeSavings(businessData.time_savings);
  if (timeSavings >= 10) score += 25;
  else if (timeSavings >= 5) score += 15;
  else if (timeSavings >= 2) score += 10;
  
  // Bonus for having current pain points
  if (businessData.pain_points && businessData.pain_points.length > 50) {
    score += 20;
  }
  
  return Math.min(score, 100); // Cap at 100
}

function extractTimeValue(timeValueText) {
  if (!timeValueText) return 0;
  const matches = timeValueText.match(/\$?(\d+)/);
  return matches ? parseInt(matches[1]) : 0;
}

function extractTimeSavings(timeSavingsText) {
  if (!timeSavingsText) return 0;
  const matches = timeSavingsText.match(/(\d+)/);
  return matches ? parseInt(matches[1]) : 0;
}
