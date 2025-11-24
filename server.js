/**
 * server.js
 * Main entry point for the Azure App Service Node.js application.
 * Handles static file serving and AI API proxying.
 */

const express = require('express');
const path = require('path');
const cors = require('cors');
const morgan = require('morgan');
const { OpenAI } = require('openai');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(morgan('tiny')); // Logging
app.use(express.static(path.join(__dirname, 'public')));

/**
 * Azure OpenAI / Standard OpenAI Configuration
 * Defaults to a mock mode if no keys are present.
 */
const getClient = () => {
  const apiKey = process.env.AZURE_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT_NAME;

  if (!apiKey) return null;

  // Configuration for Azure OpenAI
  if (process.env.AZURE_OPENAI_ENDPOINT) {
    return new OpenAI({
      apiKey: apiKey,
      baseURL: `${endpoint}/openai/deployments/${deployment}`,
      defaultQuery: { 'api-version': '2024-02-15-preview' },
      defaultHeaders: { 'api-key': apiKey }
    });
  }

  // Configuration for Standard OpenAI
  return new OpenAI({ apiKey: apiKey });
};

const openai = getClient();

/**
 * POST /api/chat
 * Handles chat requests. Supports streaming for a better UX.
 */
app.post('/api/chat', async (req, res) => {
  const { messages } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Invalid message format' });
  }

  // Mock response if no API key is configured (for testing UI)
  if (!openai) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const mockResponse = "I am a mock AI assistant. Please configure your `AZURE_OPENAI_API_KEY` or `OPENAI_API_KEY` in the App Service configuration to get real responses.\n\nHere is some code to prove I render markdown:\n```javascript\nconsole.log('Hello Azure!');\n```";
    
    // Simulate streaming
    const chunks = mockResponse.split(/(.{5})/g).filter(Boolean); // split into small chunks
    for (const chunk of chunks) {
        res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
        await new Promise(r => setTimeout(r, 50));
    }
    res.write('data: [DONE]\n\n');
    return res.end();
  }

  try {
    // Set up Server-Sent Events (SSE) for streaming
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const stream = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL_NAME || 'gpt-3.5-turbo', // Model name if using standard OpenAI, ignored by Azure usually
      messages: [
        { role: "system", content: "You are a helpful, professional AI assistant running on Azure App Service." },
        ...messages
      ],
      stream: true,
      max_tokens: 800,
      temperature: 0.7
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || "";
      if (content) {
        res.write(`data: ${JSON.stringify({ content })}\n\n`);
      }
    }

    res.write('data: [DONE]\n\n');
    res.end();

  } catch (error) {
    console.error('AI API Error:', error);
    res.write(`data: ${JSON.stringify({ error: "An error occurred while processing your request." })}\n\n`);
    res.end();
  }
});

// Serve frontend for any other route
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
