# AI File Assistant with Enhanced Provider Support

## Overview

Advanced AI-powered file assistant with support for multiple AI providers, error handling, memory system, and terminal command execution.

## Supported AI Providers

### 🦙 Ollama (Local - No API Key Required)

- Model: llama2-uncensored:7b
- URL: http://localhost:11434/api/chat
- Requirements: Ollama must be running locally

### ✨ Gemini (Google)

- Model: gemini-2.5-pro
- Requirements: Google AI API key
- Get your key: https://ai.google.dev/

### 🌟 Mistral (Cloud)

- Model: mistral-tiny
- Requirements: Mistral API key
- Get your key: https://console.mistral.ai/

### 🤖 OpenAI (ChatGPT)

- Model: gpt-4
- Requirements: OpenAI API key
- Get your key: https://platform.openai.com/api-keys

### 🧠 Claude (Anthropic)

- Model: claude-3-5-sonnet-20241022
- Requirements: Anthropic API key
- Get your key: https://console.anthropic.com/

## Features

✅ **Fixed Directory Creation Logic** - Files like `.html` are now created as files, not directories
✅ **API Key Configuration** - Secure API key input for cloud providers
✅ **Multiple AI Providers** - Support for 5 different AI services
✅ **Error Retry Logic** - Automatic retry with different approaches
✅ **Auto Error Checking** - Automatic syntax validation after file operations
✅ **Terminal Command Execution** - AI-powered terminal command generation
✅ **Memory System** - Comprehensive logging and history tracking
✅ **File Operations** - Create, edit, rewrite, delete, review files
✅ **AI Code Review** - Intelligent code analysis and improvements

## Usage

```bash
node index.js
```

1. Select your AI provider
2. Enter API key if required (masked input)
3. Choose interaction mode:
   - **Agent Mode**: AI plans and executes complex tasks
   - **Chat Mode**: Conversational interaction
   - **Command Mode**: Direct command execution

## API Key Security

- API keys are entered securely (masked input)
- Keys are stored only in memory during session
- No API keys are saved to disk
- Each provider is configured independently

## Examples

```bash
# Create files (now works correctly!)
"create calculator.html"  # ✅ Creates HTML file (not directory)
"make style.css"         # ✅ Creates CSS file
"create assets/"         # ✅ Creates directory

# AI-powered operations
"review and improve calculator.html"
"check calculator.html for errors"
"run the project"
"build the application"
```
