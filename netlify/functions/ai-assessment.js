// netlify/functions/ai-assessment.js - GPT-5 ONLY
exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY environment variable is not set');
    }

    const requestData = JSON.parse(event.body);
    const { messages, systemPrompt, maxTokens = 1500, assessmentData, isConsultationRequest } = requestData;

    // Handle consultation requests (webhook submission)
    if (isConsultationRequest && assessmentData) {
      console.log('Processing consultation request...');
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, message: 'Assessment data sent successfully' }),
      };
    }

    // Format messages for OpenAI API
    const formattedMessages = [];
    if (systemPrompt) {
      formattedMessages.push({ role: 'system', content: systemPrompt });
    }
    formattedMessages.push(...messages);

    console.log('Making request to GPT-5...');

    // Use GPT-5 ONLY
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'OpenAI-Beta': 'assistants=v2' // Enable latest features for GPT-5
      },
      body: JSON.stringify({
        model: 'gpt-5', // GPT-5 ONLY
        max_completion_tokens: maxTokens, // GPT-5 uses max_completion_tokens instead of max_tokens
        messages: formattedMessages
        // GPT-5 only supports default temperature (1) - removed all other parameters
      })
    });

    console.log('GPT-5 API response status:', response.status);

    if (!response.ok) {
      const errorData = await response.json();
      console.error('GPT-5 API error:', errorData);
      
      // If GPT-5 is not available, return clear error
      if (errorData.error && errorData.error.code === 'model_not_found') {
        throw new Error('GPT-5 is not yet available. Please wait for GPT-5 to be released by OpenAI.');
      }
      
      throw new Error(`GPT-5 API request failed: ${response.status} - ${JSON.stringify(errorData)}`);
    }

    const data = await response.json();
    console.log('GPT-5 Response Data:', JSON.stringify(data, null, 2)); // Debug log
    
    // Handle GPT-5 response format (might be different from GPT-4)
    let responseText = '';
    
    if (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) {
      // Standard OpenAI format
      responseText = data.choices[0].message.content;
    } else if (data.content && data.content[0] && data.content[0].text) {
      // Anthropic-like format
      responseText = data.content[0].text;
    } else if (data.response) {
      // Simple response format
      responseText = data.response;
    } else if (data.text) {
      // Direct text format
      responseText = data.text;
    } else {
      console.error('Unknown GPT-5 response format:', data);
      throw new Error(`Unexpected GPT-5 response format: ${JSON.stringify(data)}`);
    }
    
    console.log('Extracted GPT-5 response:', responseText);
    
    // Transform to expected format
    const transformedResponse = {
      content: [{ text: responseText }],
      usage: data.usage || { total_tokens: 0 },
      model_used: 'gpt-5'
    };
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(transformedResponse),
    };

  } catch (error) {
    console.error('GPT-5 Function error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'GPT-5 service unavailable', 
        details: error.message,
        message: 'GPT-5 may not be available yet. Please check OpenAI\'s model availability.'
      }),
    };
  }
};
