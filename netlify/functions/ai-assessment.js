// netlify/functions/ai-assessment.js - Updated for GPT-5
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
      throw new Error('Invalid OpenAI API key format - should start with sk-');
    }

    const requestData = JSON.parse(event.body);
    const { messages, systemPrompt, maxTokens = 1500, assessmentData, isConsultationRequest } = requestData;

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

    // Handle regular AI conversation with GPT-5
    console.log('Making request to OpenAI GPT-5 API...');

    // Format messages for OpenAI API
    const formattedMessages = [];
    
    // Add system message if provided
    if (systemPrompt) {
      formattedMessages.push({
        role: 'system',
        content: systemPrompt
      });
    }
    
    // Add conversation messages
    formattedMessages.push(...messages);

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'OpenAI-Beta': 'assistants=v2' // Enable latest features
      },
      body: JSON.stringify({
        model: 'gpt-5', // Use GPT-5 when available, fallback to gpt-4o for now
        max_tokens: maxTokens,
        messages: formattedMessages,
        temperature: 0.7,
        top_p: 1,
        frequency_penalty: 0,
        presence_penalty: 0
      })
    });

    console.log('OpenAI API response status:', response.status);

    if (!response.ok) {
      const errorData = await response.json();
      console.error('OpenAI API error:', errorData);
      
      // If GPT-5 isn't available yet, fallback to GPT-4o
      if (errorData.error && errorData.error.code === 'model_not_found') {
        console.log('GPT-5 not available, falling back to GPT-4o...');
        
        const fallbackResponse = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: 'gpt-4o',
            max_tokens: maxTokens,
            messages: formattedMessages,
            temperature: 0.7
          })
        });

        if (!fallbackResponse.ok) {
          const fallbackError = await fallbackResponse.json();
          throw new Error(`Fallback API request failed: ${fallbackResponse.status} - ${JSON.stringify(fallbackError)}`);
        }

        const fallbackData = await fallbackResponse.json();
        console.log('Success! Response received from GPT-4o (fallback)');
        
        // Transform response to match expected format
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            content: [{
              text: fallbackData.choices[0].message.content
            }],
            usage: fallbackData.usage,
            model_used: 'gpt-4o-fallback'
          }),
        };
      }
      
      throw new Error(`API request failed: ${response.status} - ${JSON.stringify(errorData)}`);
    }

    const data = await response.json();
    console.log('Success! Response received from GPT-5');
    
    // Transform OpenAI response format to match expected format
    const transformedResponse = {
      content: [{
        text: data.choices[0].message.content
      }],
      usage: data.usage,
      model_used: data.model
    };
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(transformedResponse),
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
  const webhookUrl = process.env.ZAPIER_WEBHOOK_URL; // Set this in Netlify env vars
  
  if (!webhookUrl) {
    console.log('No webhook URL configured, skipping webhook send');
    return;
  }

  try {
    console.log('Sending data to webhook:', webhookUrl);
    
    const webhookPayload = {
      timestamp: new Date().toISOString(),
      source: 'JAX AI Assessment (GPT-5)',
      // Individual contact fields for easier mapping
      contactName: assessmentData.contactName,
      businessName: assessmentData.businessName,
      contactEmail: assessmentData.contactEmail,
      contactPhone: assessmentData.contactPhone,
      // Business data
      businessType: assessmentData.businessData.business_type,
      businessLocation: assessmentData.businessData.business_location,
      painPoints: assessmentData.businessData.pain_points,
      currentSolution: assessmentData.businessData.current_solution,
      timeSavings: assessmentData.businessData.time_savings,
      timeValue: assessmentData.businessData.time_value,
      // Meta data
      lead_score: assessmentData.leadScore,
      ai_provider: 'OpenAI GPT-5',
      tokens_used: assessmentData.tokensUsed || 0,
      data_completeness: assessmentData.dataCompleteness || 0,
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
