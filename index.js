#!/usr/bin/env node

import inquirer from "inquirer";
import axios from "axios";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import os from "os";

// Configuration storage path
const CONFIG_DIR = path.join(os.homedir(), ".ai-file-assistant");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

// Color definitions for beautiful UI
const colors = {
  primary: "\x1b[36m", // Cyan
  secondary: "\x1b[35m", // Magenta
  success: "\x1b[32m", // Green
  warning: "\x1b[33m", // Yellow
  error: "\x1b[31m", // Red
  info: "\x1b[34m", // Blue
  highlight: "\x1b[95m", // Bright Magenta
  reset: "\x1b[0m", // Reset
  bold: "\x1b[1m", // Bold
  dim: "\x1b[2m", // Dim
};

const PROVIDERS = {
  ollama: {
    name: "Ollama",
    apiUrl: "http://localhost:11434/api/chat",
    models: [
      "llama2-uncensored:7b",
      "llama2:13b",
      "codellama:7b",
      "mistral:7b",
      "custom",
    ],
    defaultModel: "llama2-uncensored:7b",
    requiresApiKey: false,
    color: colors.info,
  },
  gemini: {
    name: "Gemini",
    apiUrl:
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent",
    models: ["gemini-2.5-pro", "gemini-1.5-flash", "gemini-1.5-pro", "custom"],
    defaultModel: "gemini-2.5-pro",
    requiresApiKey: true,
    apiKey: null,
    color: colors.primary,
  },
  mistral: {
    name: "Mistral",
    apiUrl: "https://api.mistral.ai/v1/chat/completions",
    models: [
      "mistral-tiny",
      "mistral-small",
      "mistral-medium",
      "mistral-large",
      "custom",
    ],
    defaultModel: "mistral-small",
    requiresApiKey: true,
    apiKey: null,
    color: colors.secondary,
  },
  openai: {
    name: "OpenAI",
    apiUrl: "https://api.openai.com/v1/chat/completions",
    models: ["gpt-4", "gpt-4-turbo", "gpt-3.5-turbo", "gpt-4o", "custom"],
    defaultModel: "gpt-4",
    requiresApiKey: true,
    apiKey: null,
    color: colors.success,
  },
  claude: {
    name: "Claude (Anthropic)",
    apiUrl: "https://api.anthropic.com/v1/messages",
    models: [
      "claude-3-5-sonnet-20241022",
      "claude-3-opus-20240229",
      "claude-3-haiku-20240307",
      "custom",
    ],
    defaultModel: "claude-3-5-sonnet-20241022",
    requiresApiKey: true,
    apiKey: null,
    color: colors.highlight,
  },
};

// Memory Buffer System
class MemoryBuffer {
  constructor(maxSize = 50) {
    this.buffer = [];
    this.maxSize = maxSize;
    this.conversationHistory = [];
    this.consoleLog = []; // Track all console output
    this.allCommands = []; // Track all executed commands
  }

  addEntry(type, data) {
    const entry = {
      timestamp: new Date().toISOString(),
      type: type,
      data: data,
      id: this.buffer.length + 1,
    };

    this.buffer.push(entry);

    // Maintain buffer size
    if (this.buffer.length > this.maxSize) {
      this.buffer.shift();
    }

    const logMessage = `\n📝 Memory: ${type} logged (${this.buffer.length}/${this.maxSize})`;
    console.log(logMessage);
    this.addConsoleLog("system", logMessage);
    return entry;
  }

  addConversation(userInput, aiResponse, action) {
    const conversation = {
      timestamp: new Date().toISOString(),
      userInput: userInput,
      aiResponse: aiResponse,
      action: action,
      id: this.conversationHistory.length + 1,
    };

    this.conversationHistory.push(conversation);
    const logMessage = `\n💬 Conversation logged: ${action}`;
    console.log(logMessage);
    this.addConsoleLog("system", logMessage);
    return conversation;
  }

  addConsoleLog(type, message) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      type: type, // 'user', 'system', 'ai', 'output'
      message: message,
      id: this.consoleLog.length + 1,
    };
    this.consoleLog.push(logEntry);

    // Keep console log manageable
    if (this.consoleLog.length > 200) {
      this.consoleLog = this.consoleLog.slice(-150);
    }
  }

  addCommand(command, result) {
    const commandEntry = {
      timestamp: new Date().toISOString(),
      command: command,
      result: result,
      success: result?.success || false,
      id: this.allCommands.length + 1,
    };
    this.allCommands.push(commandEntry);
    this.addConsoleLog(
      "command",
      `Executed: ${command} - ${result?.message || "Unknown result"}`
    );
  }

  getRecentEntries(count = 10) {
    return this.buffer.slice(-count);
  }

  getConversationHistory(count = 10) {
    return this.conversationHistory.slice(-count);
  }

  getConsoleHistory(count = 20) {
    return this.consoleLog.slice(-count);
  }

  getAllCommands(count = 20) {
    return this.allCommands.slice(-count);
  }

  getMemorySummary() {
    const summary = {
      totalEntries: this.buffer.length,
      totalConversations: this.conversationHistory.length,
      totalConsoleEntries: this.consoleLog.length,
      totalCommands: this.allCommands.length,
      recentActions: this.buffer
        .slice(-5)
        .map(
          (e) => `${e.type}: ${e.data.summary || e.data.target || "action"}`
        ),
      recentCommands: this.allCommands
        .slice(-3)
        .map((c) => `${c.command} (${c.success ? "✅" : "❌"})`),
      memoryUsage: `${this.buffer.length}/${this.maxSize}`,
    };
    return summary;
  }

  clearMemory() {
    this.buffer = [];
    this.conversationHistory = [];
    this.consoleLog = [];
    this.allCommands = [];
    console.log("🧠 Memory cleared");
  }

  // Get file content from memory by filename or path
  getFileFromMemory(filename) {
    const fileEntries = this.buffer.filter(
      (entry) =>
        entry.type === "file_read" &&
        (entry.data.target.includes(filename) ||
          path.basename(entry.data.target) === filename)
    );

    if (fileEntries.length > 0) {
      // Return the most recent file read
      const latestFile = fileEntries[fileEntries.length - 1];
      return {
        found: true,
        filePath: latestFile.data.target,
        content: latestFile.data.content,
        size: latestFile.data.size,
        lines: latestFile.data.lines,
        lastRead: latestFile.timestamp,
        extension: latestFile.data.extension,
      };
    }

    return { found: false, message: `File '${filename}' not found in memory` };
  }

  // Get all files stored in memory
  getAllFilesInMemory() {
    const fileEntries = this.buffer.filter(
      (entry) => entry.type === "file_read"
    );
    return fileEntries.map((entry) => ({
      filename: path.basename(entry.data.target),
      filePath: entry.data.target,
      size: entry.data.size,
      lines: entry.data.lines,
      extension: entry.data.extension,
      lastRead: entry.timestamp,
      content: entry.data.content,
    }));
  }

  // Search for text within stored file contents
  searchInStoredFiles(searchText) {
    const fileEntries = this.buffer.filter(
      (entry) => entry.type === "file_read"
    );
    const results = [];

    fileEntries.forEach((entry) => {
      if (
        entry.data.content &&
        entry.data.content.toLowerCase().includes(searchText.toLowerCase())
      ) {
        const lines = entry.data.content.split("\n");
        const matchingLines = [];

        lines.forEach((line, index) => {
          if (line.toLowerCase().includes(searchText.toLowerCase())) {
            matchingLines.push({
              lineNumber: index + 1,
              content: line.trim(),
            });
          }
        });

        results.push({
          filename: path.basename(entry.data.target),
          filePath: entry.data.target,
          matches: matchingLines.length,
          matchingLines: matchingLines.slice(0, 5), // Limit to first 5 matches per file
        });
      }
    });

    return results;
  }

  // Store a file in memory with its complete content
  storeFile(filePath, content) {
    console.log(`📋 Storing file in memory: ${path.basename(filePath)}`);

    // Add as a file_read entry to be consistent with how files are tracked
    return this.addEntry("file_read", {
      target: filePath,
      content: content,
      size: content.length,
      lines: content.split(/\r?\n/).length,
      extension: path.extname(filePath),
      summary: `File ${path.basename(filePath)} stored in memory`,
    });
  }
}

// Configuration Management
function loadConfig() {
  try {
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }

    if (fs.existsSync(CONFIG_FILE)) {
      const config = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
      // Load saved API keys and models into PROVIDERS
      for (const [providerKey, providerConfig] of Object.entries(
        config.providers || {}
      )) {
        if (PROVIDERS[providerKey]) {
          PROVIDERS[providerKey].apiKey = providerConfig.apiKey;
          PROVIDERS[providerKey].selectedModel =
            providerConfig.selectedModel || PROVIDERS[providerKey].defaultModel;
        }
      }
      return config;
    }
  } catch (error) {
    console.log(
      `${colors.warning}⚠️ Warning: Could not load config: ${error.message}${colors.reset}`
    );
  }
  return { providers: {}, preferences: {} };
}

function saveConfig(config) {
  try {
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
    console.log(
      `${colors.success}✅ Configuration saved successfully${colors.reset}`
    );
  } catch (error) {
    console.log(
      `${colors.error}❌ Could not save config: ${error.message}${colors.reset}`
    );
  }
}

function updateProviderConfig(provider, apiKey, model) {
  const config = loadConfig();
  if (!config.providers) config.providers = {};

  config.providers[provider] = {
    apiKey: apiKey,
    selectedModel: model,
  };

  saveConfig(config);
  PROVIDERS[provider].apiKey = apiKey;
  PROVIDERS[provider].selectedModel = model;
}

// Enhanced logging with colors
function log(message, type = "info") {
  const timestamp = new Date().toLocaleTimeString();
  const colorMap = {
    info: colors.info,
    success: colors.success,
    warning: colors.warning,
    error: colors.error,
    highlight: colors.highlight,
  };

  console.log(
    `${colors.dim}[${timestamp}]${colors.reset} ${
      colorMap[type] || colors.info
    }${message}${colors.reset}`
  );
}

// Global memory instance
const memory = new MemoryBuffer(50);

// Enhanced Loading Animation with Colors
async function showLoadingAnimation(
  message,
  asyncFunction,
  color = colors.primary
) {
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let frameIndex = 0;

  console.log(`\n${color}${colors.bold}${message}${colors.reset}`);

  const interval = setInterval(() => {
    const frame = frames[frameIndex % frames.length];
    process.stdout.write(`\r${color}${frame} Processing...⚡${colors.reset}`);
    frameIndex++;
  }, 100);

  try {
    const result = await asyncFunction();
    clearInterval(interval);
    process.stdout.write(`\r${colors.success}✓ Complete!${colors.reset}\n`);
    return result;
  } catch (error) {
    clearInterval(interval);
    process.stdout.write(`\r${colors.error}✗ Error!${colors.reset}\n`);
    throw error;
  }
}

// AI Summary and Decision Function
async function generateAISummary(action, result, provider, memory) {
  try {
    const prompt = `Based on the following operation, generate a brief summary and suggest next steps:

Operation: ${action}
Result: ${result.message}
File: ${result.filePath || "N/A"}

Provide:
1. A brief summary of what was accomplished
2. Suggested next steps or improvements
3. Any potential concerns or recommendations

Keep it concise but helpful.`;

    console.log("\n🤖 AI SUMMARY & RECOMMENDATIONS:");
    console.log("=".repeat(50));

    const summary = await callAI(prompt, provider);
    console.log(summary);

    // Store the summary in memory
    memory.addEntry("ai_summary", {
      action: action,
      result: result,
      summary: summary,
      timestamp: new Date().toISOString(),
    });

    memory.addConsoleLog("ai", `AI Summary: ${summary}`);
  } catch (error) {
    console.log("❌ Could not generate AI summary:", error.message);
  }
}

// AI Thinking Function - makes AI reflect after each step
async function aiThinking(step, result, provider, memory) {
  try {
    const thinkingPrompt = `You are an AI assistant reflecting on a completed step. Analyze what just happened and think about the next steps.

COMPLETED STEP:
Action: ${step.action}
Target: ${step.target}
Prompt: ${step.prompt || "N/A"}
Result: ${result.success ? "SUCCESS" : "FAILED"}
Message: ${result.message}

REFLECTION REQUIRED:
1. What was accomplished or what went wrong?
2. How does this affect the overall task?
3. What should be done differently or what's next?
4. Any potential issues or optimizations?

Provide a brief, insightful reflection in 2-3 sentences.`;

    console.log("\n🤔 AI Thinking...");

    const thinking = await callAI(thinkingPrompt, provider);
    console.log(`\n💭 AI Reflection: ${thinking}`);

    // Store thinking in memory
    memory.addEntry("ai_thinking", {
      step: step,
      result: result,
      thinking: thinking,
      summary: `AI reflected on step ${step.step}: ${step.action}`,
    });

    memory.addConsoleLog("ai", `AI Thinking: ${thinking}`);
  } catch (error) {
    console.log("❌ AI thinking failed:", error.message);
    memory.addConsoleLog("system", `AI thinking failed: ${error.message}`);
  }
}

// Enhanced AI calling function with better error handling and model support
async function callAI(prompt, provider) {
  try {
    let response, content;
    const selectedModel =
      PROVIDERS[provider].selectedModel || PROVIDERS[provider].defaultModel;

    if (provider === "gemini") {
      response = await axios.post(
        `${PROVIDERS.gemini.apiUrl}?key=${PROVIDERS.gemini.apiKey}`,
        {
          contents: [
            {
              role: "user",
              parts: [{ text: prompt }],
            },
          ],
          generationConfig: {
            temperature: 0.3,
            topP: 0.8,
            topK: 40,
            maxOutputTokens: 8192,
          },
        }
      );
      content = response.data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    } else if (provider === "ollama") {
      response = await axios.post(PROVIDERS.ollama.apiUrl, {
        model: selectedModel,
        messages: [{ role: "user", content: prompt }],
        stream: false,
        options: {
          temperature: 0.3,
          top_p: 0.8,
          num_predict: 4096,
        },
      });
      content = response.data.message.content;
    } else if (provider === "mistral") {
      response = await axios.post(
        PROVIDERS.mistral.apiUrl,
        {
          model: selectedModel,
          messages: [{ role: "user", content: prompt }],
          temperature: 0.3,
          top_p: 0.8,
          max_tokens: 4096,
        },
        {
          headers: {
            Authorization: `Bearer ${PROVIDERS.mistral.apiKey}`,
            "Content-Type": "application/json",
          },
        }
      );
      content = response.data.choices?.[0]?.message?.content || "";
    } else if (provider === "openai") {
      response = await axios.post(
        PROVIDERS.openai.apiUrl,
        {
          model: selectedModel,
          messages: [{ role: "user", content: prompt }],
          temperature: 0.3,
          top_p: 0.8,
          max_tokens: 4096,
        },
        {
          headers: {
            Authorization: `Bearer ${PROVIDERS.openai.apiKey}`,
            "Content-Type": "application/json",
          },
        }
      );
      content = response.data.choices?.[0]?.message?.content || "";
    } else if (provider === "claude") {
      response = await axios.post(
        PROVIDERS.claude.apiUrl,
        {
          model: selectedModel,
          max_tokens: 4096,
          temperature: 0.3,
          messages: [{ role: "user", content: prompt }],
        },
        {
          headers: {
            "x-api-key": PROVIDERS.claude.apiKey,
            "Content-Type": "application/json",
            "anthropic-version": "2023-06-01",
          },
        }
      );
      content = response.data.content?.[0]?.text || "";
    }

    return content.trim();
  } catch (error) {
    log(`Error with ${PROVIDERS[provider].name}: ${error.message}`, "error");
    return `Error generating AI response: ${error.message}`;
  }
}

// Utility to get .gitignore patterns
function getGitignorePatterns() {
  const gitignorePath = path.resolve(process.cwd(), ".gitignore");
  if (fs.existsSync(gitignorePath)) {
    const lines = fs.readFileSync(gitignorePath, "utf-8").split(/\r?\n/);
    // Only take non-empty, non-comment lines, and trim trailing slashes
    return lines
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"))
      .map((l) => l.replace(/\/$/, ""));
  }
  return [];
}

// Utility to recursively search for a file, ignoring node_modules and .gitignore
function findFiles(target, fuzzy = false) {
  const ignore = ["node_modules", ...getGitignorePatterns()];
  const results = [];

  // Parse target to separate directory and filename parts
  // Examples: "calculator sus" -> dir="sus", file="calculator"
  //          "testfiles/calculator" -> dir="testfiles", file="calculator"
  //          "calculator.html" -> dir=null, file="calculator.html"

  let targetName, targetDir;

  // Check if target contains spaces - likely "filename directory" format
  if (target.includes(" ") && !target.includes("/") && !target.includes("\\")) {
    const parts = target.split(" ");
    if (parts.length === 2) {
      targetName = parts[0]; // filename part
      targetDir = parts[1]; // directory part
    } else {
      targetName = path.basename(target);
      targetDir = path.dirname(target) === "." ? null : path.dirname(target);
    }
  } else {
    // Standard path format
    targetName = path.basename(target);
    targetDir = path.dirname(target) === "." ? null : path.dirname(target);
  }

  console.log(
    `Searching for: filename="${targetName}", directory="${targetDir}", fuzzy=${fuzzy}`
  );

  function search(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (ignore.includes(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);

      if (entry.isFile()) {
        const matchesName = fuzzy
          ? entry.name.startsWith(targetName)
          : entry.name === targetName;

        if (matchesName) {
          // If no specific directory requested, add all matches
          if (!targetDir) {
            results.push(fullPath);
          } else {
            // Check if file is in the specified directory
            const fileDir = path.dirname(fullPath);
            const relativePath = path.relative(process.cwd(), fileDir);

            if (
              relativePath === targetDir ||
              relativePath.endsWith(targetDir) ||
              fileDir.endsWith(targetDir) ||
              path.basename(fileDir) === targetDir
            ) {
              results.push(fullPath);
            }
          }
        }
      } else if (entry.isDirectory()) {
        if (ignore.includes(entry.name)) continue;
        search(fullPath);
      }
    }
  }

  search(process.cwd());
  return results;
}

// Utility to print tree view, ignoring node_modules and .gitignore
function printTreeView(root, highlightPaths = []) {
  const ignore = ["node_modules", ...getGitignorePatterns()];
  function walk(dir, prefix = "") {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (ignore.includes(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      const isLast = i === entries.length - 1;
      const connector = isLast ? "└── " : "├── ";
      let display = entry.name;
      if (highlightPaths && highlightPaths.includes(fullPath))
        display += "  <==";
      console.log(prefix + connector + display);
      if (entry.isDirectory()) {
        if (ignore.includes(entry.name)) continue;
        walk(fullPath, prefix + (isLast ? "    " : "│   "));
      }
    }
  }
  walk(root);
}

async function getCommandFromNLP(input, provider) {
  try {
    let response, content;
    if (provider === "ollama") {
      response = await axios.post(PROVIDERS.ollama.apiUrl, {
        model: PROVIDERS.ollama.model,
        messages: [
          {
            role: "system",
            content: `You are a helpful assistant that translates natural language into JSON commands. The user will provide a command in natural language, and you should identify the action (e.g., 'create', 'delete', 'check', 'read', 'edit', 'rewrite', 'errors', 'review'), the target file or directory, and a prompt for content generation if applicable. The JSON output must be a valid JSON object with three properties: 'action', 'target', and 'prompt'.

For example:
- 'create a file named my-file.txt' should be converted to: { "action": "create", "target": "my-file.txt", "prompt": "" }
- 'delete the my-file.txt file' should be converted to: { "action": "delete", "target": "my-file.txt", "prompt": "" }
- 'make a page.tsx for a calculator' should be converted to: { "action": "create", "target": "page.tsx", "prompt": "a page.tsx for a calculator" }
- 'make a calculator.html in /testfiles' should be converted to: { "action": "create", "target": "/testfiles/calculator.html", "prompt": "a calculator.html" }
- 'check if calculator.html exists' should be converted to: { "action": "check", "target": "calculator.html", "prompt": "" }
- 'what are the contents of the file calculator.html' should be converted to: { "action": "read", "target": "calculator.html", "prompt": "" }
- 'make the testfiles calculator red in color' should be converted to: { "action": "edit", "target": "testfiles/calculator", "prompt": "make the calculator red in color" }
- 'completely rewrite calculator.html as a modern calculator' should be converted to: { "action": "rewrite", "target": "calculator.html", "prompt": "completely rewrite as a modern calculator" }
- 'rewrite the calculator to use React' should be converted to: { "action": "rewrite", "target": "calculator", "prompt": "rewrite to use React" }
- 'remove errors from calculator.html' should be converted to: { "action": "errors", "target": "calculator.html", "prompt": "" }
- 'check calculator.html for syntax errors' should be converted to: { "action": "errors", "target": "calculator.html", "prompt": "" }
- 'review and improve calculator.html' should be converted to: { "action": "review", "target": "calculator.html", "prompt": "" }
- 'ai review of my code in calculator.html' should be converted to: { "action": "review", "target": "calculator.html", "prompt": "" }

Command list:
1. create - Create new files
2. delete - Remove files
3. check - Verify file existence  
4. read - Read file contents
5. edit - Modify existing files
6. rewrite - Completely rewrite files
7. errors - Check for syntax/linting errors
8. review - AI-powered code review and improvement

Please ensure the output is only the JSON object, with no additional text or explanations. The JSON object must be complete and properly formatted.`,
          },
          {
            role: "user",
            content: input,
          },
        ],
        stream: false,
      });
      content = response.data.message.content;
    } else if (provider === "gemini") {
      response = await axios.post(PROVIDERS.gemini.apiUrl, {
        contents: [
          {
            role: "user",
            parts: [
              {
                text: `You are a helpful assistant that translates natural language into JSON commands. The user will provide a command in natural language, and you should identify the action (e.g., 'create', 'delete', 'check', 'read', 'edit', 'rewrite'), the target file or directory, and a prompt for content generation if applicable. The JSON output must be a valid JSON object with three properties: 'action', 'target', and 'prompt'.

For example:
- 'create a file named my-file.txt' should be converted to: { "action": "create", "target": "my-file.txt", "prompt": "" }
- 'delete the my-file.txt file' should be converted to: { "action": "delete", "target": "my-file.txt", "prompt": "" }
- 'make a page.tsx for a calculator' should be converted to: { "action": "create", "target": "page.tsx", "prompt": "a page.tsx for a calculator" }
- 'make a calculator.html in /testfiles' should be converted to: { "action": "create", "target": "/testfiles/calculator.html", "prompt": "a calculator.html" }
- 'check if calculator.html exists' should be converted to: { "action": "check", "target": "calculator.html", "prompt": "" }
- 'what are the contents of the file calculator.html' should be converted to: { "action": "read", "target": "calculator.html", "prompt": "" }
- 'make the testfiles calculator red in color' should be converted to: { "action": "edit", "target": "testfiles/calculator", "prompt": "make the calculator red in color" }
- 'completely rewrite calculator.html as a modern calculator' should be converted to: { "action": "rewrite", "target": "calculator.html", "prompt": "completely rewrite as a modern calculator" }
- 'rewrite the calculator to use React' should be converted to: { "action": "rewrite", "target": "calculator", "prompt": "rewrite to use React" }

Please ensure the output is only the JSON object, with no additional text or explanations. The JSON object must be complete and properly formatted.

User input: ${input}`,
              },
            ],
          },
        ],
      });
      content = response.data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    } else if (provider === "mistral") {
      response = await axios.post(
        PROVIDERS.mistral.apiUrl,
        {
          model: PROVIDERS.mistral.model,
          messages: [
            {
              role: "system",
              content: `You are a helpful assistant that translates natural language into JSON commands. The user will provide a command in natural language, and you should identify the action (e.g., 'create', 'delete', 'check', 'read', 'edit', 'rewrite'), the target file or directory, and a prompt for content generation if applicable. The JSON output must be a valid JSON object with three properties: 'action', 'target', and 'prompt'.

For example:
- 'create a file named my-file.txt' should be converted to: { "action": "create", "target": "my-file.txt", "prompt": "" }
- 'delete the my-file.txt file' should be converted to: { "action": "delete", "target": "my-file.txt", "prompt": "" }
- 'make a page.tsx for a calculator' should be converted to: { "action": "create", "target": "page.tsx", "prompt": "a page.tsx for a calculator" }
- 'make a calculator.html in /testfiles' should be converted to: { "action": "create", "target": "/testfiles/calculator.html", "prompt": "a calculator.html" }
- 'check if calculator.html exists' should be converted to: { "action": "check", "target": "calculator.html", "prompt": "" }
- 'what are the contents of the file calculator.html' should be converted to: { "action": "read", "target": "calculator.html", "prompt": "" }
- 'make the testfiles calculator red in color' should be converted to: { "action": "edit", "target": "testfiles/calculator", "prompt": "make the calculator red in color" }
- 'completely rewrite calculator.html as a modern calculator' should be converted to: { "action": "rewrite", "target": "calculator.html", "prompt": "completely rewrite as a modern calculator" }
- 'rewrite the calculator to use React' should be converted to: { "action": "rewrite", "target": "calculator", "prompt": "rewrite to use React" }

Please ensure the output is only the JSON object, with no additional text or explanations. The JSON object must be complete and properly formatted.`,
            },
          ],
        },
        {
          headers: {
            Authorization: `Bearer ${PROVIDERS.mistral.apiKey}`,
            "Content-Type": "application/json",
          },
        }
      );
      content = response.data.choices?.[0]?.message?.content || "";
    }

    console.log(
      `${PROVIDERS[provider].name} Response:`,
      JSON.stringify(response.data, null, 2)
    );
    try {
      const jsonMatch = content.match(/\{.*\}/s);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      return JSON.parse(content);
    } catch (e) {
      console.error(
        `Failed to parse JSON from ${PROVIDERS[provider].name} response:`,
        e.message
      );
      return null;
    }
  } catch (error) {
    console.error(
      `Error communicating with ${PROVIDERS[provider].name}:`,
      error.message
    );
    return null;
  }
}

async function editFileContent(filePath, editPrompt, provider) {
  try {
    const fileContents = fs.readFileSync(filePath, "utf-8");

    const systemPrompt = `You are a helpful assistant that edits file content. You will be given the current file content and an edit instruction. 

Respond with ONLY the changes needed using this format:

REPLACE:
[exact text to find and replace including whitespace and indentation]
WITH:
[exact replacement text]

OR

INSERT_AFTER:
[exact text to find]
NEW_CONTENT:
[new content to insert after the found text]

Use REPLACE when modifying existing content.
Use INSERT_AFTER when adding new content.
Be precise with whitespace and indentation.
If making multiple changes, separate them with "---"

Example 1 (Replace):
REPLACE:
<body>
WITH:
<body style="background-color: red;">

Example 2 (Insert):
INSERT_AFTER:
</head>
NEW_CONTENT:
<style>
  .new-class { color: blue; }
</style>

Example 3 (Multiple changes):
REPLACE:
<title>Old Title</title>
WITH:
<title>New Title</title>
---
INSERT_AFTER:
</body>
NEW_CONTENT:
<script>console.log('Added script');</script>

File content:
${fileContents}

Edit instruction: ${editPrompt}`;

    const content = await callAI(systemPrompt, provider);

    // Clean up the content - remove code blocks and extra text
    if (typeof content === "string") {
      return content.replace(/```[a-zA-Z]*\n?|```/g, "").trim();
    }

    return content;
  } catch (error) {
    console.error(
      `Error editing file content with ${PROVIDERS[provider].name}:`,
      error.message
    );
    return "";
  }
}

// Enhanced version that uses content from memory instead of reading from disk
async function editFileContentFromMemory(
  filePath,
  fileContents,
  editPrompt,
  provider
) {
  try {
    const systemPrompt = `You are a helpful assistant that edits file content. You will be given the current file content and an edit instruction. 

Respond with ONLY the changes needed using this format:

REPLACE:
[exact text to find and replace including whitespace and indentation]
WITH:
[exact replacement text]

OR

INSERT_AFTER:
[exact text to find]
NEW_CONTENT:
[new content to insert after the found text]

Use REPLACE when modifying existing content.
Use INSERT_AFTER when adding new content.
Be precise with whitespace and indentation.
If making multiple changes, separate them with "---"

Example 1 (Replace):
REPLACE:
<body>
WITH:
<body style="background-color: red;">

Example 2 (Insert):
INSERT_AFTER:
</head>
NEW_CONTENT:
<style>
  .new-class { color: blue; }
</style>

Example 3 (Multiple changes):
REPLACE:
<title>Old Title</title>
WITH:
<title>New Title</title>
---
INSERT_AFTER:
</body>
NEW_CONTENT:
<script>console.log('Added script');</script>

File content:
${fileContents}

Edit instruction: ${editPrompt}`;

    const content = await callAI(systemPrompt, provider);

    // Clean up the content - remove code blocks and extra text
    if (typeof content === "string") {
      return content.replace(/```[a-zA-Z]*\n?|```/g, "").trim();
    }

    return content;
  } catch (error) {
    console.error(
      `Error editing file content with ${PROVIDERS[provider].name}:`,
      error.message
    );
    return "";
  }
}

function applyContextChanges(filePath, changeContent) {
  let fileContents = fs.readFileSync(filePath, "utf-8");
  console.log(`\nApplying changes to ${filePath}:`);
  console.log("=".repeat(50));
  console.log(changeContent);
  console.log("=".repeat(50));

  // Split multiple changes by "---"
  const changes = changeContent
    .split("---")
    .map((change) => change.trim())
    .filter((change) => change);

  for (const change of changes) {
    console.log(`\nProcessing change: ${change.substring(0, 50)}...`);

    if (change.includes("REPLACE:") && change.includes("WITH:")) {
      // Handle REPLACE operation
      const replaceParts = change.split("WITH:");
      if (replaceParts.length === 2) {
        const findText = replaceParts[0].replace("REPLACE:", "").trim();
        const replaceText = replaceParts[1].trim();

        if (fileContents.includes(findText)) {
          fileContents = fileContents.replace(findText, replaceText);
          console.log(`✓ REPLACED: "${findText}" → "${replaceText}"`);
        } else {
          console.log(`✗ NOT FOUND: "${findText}"`);
        }
      }
    } else if (
      change.includes("INSERT_AFTER:") &&
      change.includes("NEW_CONTENT:")
    ) {
      // Handle INSERT_AFTER operation
      const insertParts = change.split("NEW_CONTENT:");
      if (insertParts.length === 2) {
        const afterText = insertParts[0].replace("INSERT_AFTER:", "").trim();
        const newContent = insertParts[1].trim();

        if (fileContents.includes(afterText)) {
          const insertPosition =
            fileContents.indexOf(afterText) + afterText.length;
          fileContents =
            fileContents.slice(0, insertPosition) +
            "\n" +
            newContent +
            fileContents.slice(insertPosition);
          console.log(`✓ INSERTED after: "${afterText}"`);
          console.log(`  New content: "${newContent}"`);
        } else {
          console.log(`✗ NOT FOUND: "${afterText}"`);
        }
      }
    } else {
      console.log(
        `✗ INVALID FORMAT: Change must use REPLACE/WITH or INSERT_AFTER/NEW_CONTENT`
      );
    }
  }

  // Write the modified content back
  fs.writeFileSync(filePath, fileContents);
  console.log(`\n✓ Changes applied successfully to ${filePath}`);
}

async function rewriteFileContent(filePath, rewritePrompt, provider) {
  try {
    const fileContents = fs.readFileSync(filePath, "utf-8");

    const systemPrompt = `You are a helpful assistant that completely rewrites file content based on a prompt. You will be given the current file content and an instruction to rewrite it. 

Your task is to generate a COMPLETE replacement for the entire file content. Do not provide partial changes or diffs - provide the full new file content that should replace everything.

The response should be ONLY the new file content, with no explanations, no code blocks, and no additional text.

Current file content:
${fileContents}

Rewrite instruction: ${rewritePrompt}

Provide the complete new file content:`;

    const content = await callAI(systemPrompt, provider);

    // Clean up the content - remove code blocks and extra text
    if (typeof content === "string") {
      return content.replace(/```[a-zA-Z]*\n?|```/g, "").trim();
    }

    return content;
  } catch (error) {
    console.error(
      `Error rewriting file content with ${PROVIDERS[provider].name}:`,
      error.message
    );
    return "";
  }
}

// Enhanced version that uses content from memory instead of reading from disk
async function rewriteFileContentFromMemory(
  filePath,
  fileContents,
  rewritePrompt,
  provider
) {
  try {
    const systemPrompt = `You are a helpful assistant that completely rewrites file content based on a prompt. You will be given the current file content and an instruction to rewrite it. 

Your task is to generate a COMPLETE replacement for the entire file content. Do not provide partial changes or diffs - provide the full new file content that should replace everything.

The response should be ONLY the new file content, with no explanations, no code blocks, and no additional text.

Current file content:
${fileContents}

Rewrite instruction: ${rewritePrompt}

Provide the complete new file content:`;

    const content = await callAI(systemPrompt, provider);

    // Clean up the content - remove code blocks and extra text
    if (typeof content === "string") {
      return content.replace(/```[a-zA-Z]*\n?|```/g, "").trim();
    }

    return content;
  } catch (error) {
    console.error(
      `Error rewriting file content with ${PROVIDERS[provider].name}:`,
      error.message
    );
    return "";
  }
}

async function checkFileErrors(filePath, provider) {
  try {
    const fileContents = fs.readFileSync(filePath, "utf-8");
    const fileExt = path.extname(filePath).toLowerCase();

    const systemPrompt = `You are a helpful assistant that checks files for syntax errors, linting issues, and potential problems. Analyze the given file content and report any errors you find.

Check for:
1. Syntax errors
2. Missing semicolons (JavaScript/CSS)
3. Unclosed tags (HTML)
4. Missing quotes
5. Bracket/parentheses mismatches
6. Invalid CSS properties
7. Accessibility issues (HTML)
8. Performance issues
9. Best practice violations

File extension: ${fileExt}
File content:
${fileContents}

Respond with a detailed analysis of any errors found, or "NO ERRORS FOUND" if the file is clean.`;

    return await callAI(systemPrompt, provider);
  } catch (error) {
    console.error(
      `Error checking file errors with ${PROVIDERS[provider].name}:`,
      error.message
    );
    return "Error analyzing file";
  }
}

// Enhanced version that uses content from memory instead of reading from disk
async function checkFileErrorsFromMemory(filePath, fileContents, provider) {
  try {
    const fileExt = path.extname(filePath).toLowerCase();

    const systemPrompt = `You are a helpful assistant that checks files for syntax errors, linting issues, and potential problems. Analyze the given file content and report any errors you find.

Check for:
1. Syntax errors
2. Missing semicolons (JavaScript/CSS)
3. Unclosed tags (HTML)
4. Missing quotes
5. Bracket/parentheses mismatches
6. Invalid CSS properties
7. Accessibility issues (HTML)
8. Performance issues
9. Best practice violations

File extension: ${fileExt}
File content:
${fileContents}

Respond with a detailed analysis of any errors found, or "NO ERRORS FOUND" if the file is clean.`;

    return await callAI(systemPrompt, provider);
  } catch (error) {
    console.error(
      `Error checking file errors with ${PROVIDERS[provider].name}:`,
      error.message
    );
    return "Error analyzing file";
  }
}

async function reviewAndImproveFile(filePath, provider) {
  try {
    const fileContents = fs.readFileSync(filePath, "utf-8");
    const fileExt = path.extname(filePath).toLowerCase();

    const systemPrompt = `You are an expert code reviewer and feature enhancer. Analyze the given file and suggest improvements, new features, and fixes.

1. Review the code/content for:
   - Performance optimizations
   - Security improvements
   - Accessibility enhancements
   - Modern best practices
   - Missing features that would be useful
   - Code organization improvements

2. Then provide the COMPLETE improved file content with:
   - All identified issues fixed
   - Suggested new features implemented
   - Better structure and organization
   - Modern syntax and practices

File extension: ${fileExt}
Original file content:
${fileContents}

Respond with:
ANALYSIS:
[Your detailed analysis of current issues and suggested improvements]

IMPROVED_CODE:
[Complete improved file content with all fixes and new features]`;

    return await callAI(systemPrompt, provider);
  } catch (error) {
    console.error(
      `Error reviewing file with ${PROVIDERS[provider].name}:`,
      error.message
    );
    return "Error reviewing file";
  }
}

// Enhanced version that uses content from memory instead of reading from disk
async function reviewFileContentFromMemory(filePath, fileContents, provider) {
  try {
    const fileExt = path.extname(filePath).toLowerCase();

    const systemPrompt = `You are an expert code reviewer and feature enhancer. Analyze the given file and suggest improvements, new features, and fixes.

1. Review the code/content for:
   - Performance optimizations
   - Security improvements
   - Accessibility enhancements
   - Modern best practices
   - Missing features that would be useful
   - Code organization improvements

2. Then provide the COMPLETE improved file content with:
   - All identified issues fixed
   - Suggested new features implemented
   - Better structure and organization
   - Modern syntax and practices

File: ${filePath}
Extension: ${fileExt}
Current file content:
${fileContents}

Respond with:
ANALYSIS:
[Your detailed analysis of current issues and suggested improvements]

IMPROVED_CODE:
[Complete improved file content with all fixes and new features]`;

    return await callAI(systemPrompt, provider);
  } catch (error) {
    console.error(
      `Error reviewing file with ${PROVIDERS[provider].name}:`,
      error.message
    );
    return "Error reviewing file";
  }
}

async function chatModeAgent(userInput, provider, memory = null) {
  console.log("\n🤖 Chat Mode Agent Activated");
  console.log("=".repeat(50));

  // Step 1: Analyze and create execution plan
  const planPrompt = `You are an AI assistant that creates execution plans for file operations with deep understanding of project structures and file relationships.

Given a user request, break it down into individual actionable steps using these available actions:
- create (create new files or directories)
- delete (remove files) 
- check (verify file existence)
- read (read file contents)
- edit (modify existing files)
- rewrite (completely rewrite files)
- errors (check for errors in files)
- review (AI-powered code review and improvement)
- terminal (execute terminal/command line commands like npm run build, node ., etc.)

User request: "${userInput}"

CRITICAL PROJECT ANALYSIS RULES:
1. ANALYZE PROJECT TYPE: Determine what kind of project this is (web app, Python project, Next.js, etc.)
2. UNDERSTAND FILE RELATIONSHIPS: Files should work together as a cohesive system
3. CREATE PROPER LINKS: Automatically link files (HTML imports CSS/JS, Python imports modules, etc.)
4. FUNCTIONAL CODEBASE: Create working code that actually functions together

PROJECT TYPE PATTERNS:
- HTML/CSS/JS: Link CSS in <head>, JS before </body>, use proper selectors
- Python: Create __init__.py, proper imports, main execution
- Next.js: Components with proper imports, pages structure, tailwind/styles
- React: Components with imports, proper JSX, state management
- Node.js: package.json, proper requires/imports, main entry point

FILE CREATION RULES:
- When user mentions "css", create "style.css" or "styles.css" (not directory)
- When user mentions "js", create "script.js" or "main.js" (not directory)  
- When user mentions "html", create proper .html file
- For web projects: HTML should link CSS and JS files
- For Python: Create __init__.py and proper module structure
- For React/Next.js: Create proper component structure with imports

CONTENT GENERATION APPROACH:
- Analyze what the user wants to build
- Create files that work together as a system
- Include proper imports, links, and dependencies
- Generate functional code, not just templates

Respond with a JSON array of steps in this format:
[
  {
    "step": 1,
    "action": "action_name", 
    "target": "file_or_directory_or_command",
    "prompt": "DETAILED description including project type, relationships, and functionality needed",
    "reasoning": "why_this_step_is_needed",
    "projectType": "web|python|nextjs|react|nodejs|other",
    "relationships": ["list", "of", "files", "this", "relates", "to"]
  }
]

Examples:
- For "calculator html css js": 
  {"action": "create", "target": "calculator.html", "prompt": "Create HTML calculator with proper CSS and JS links, functional calculator interface", "projectType": "web", "relationships": ["style.css", "script.js"]}
- For "Python module": 
  {"action": "create", "target": "__init__.py", "prompt": "Create Python package initialization", "projectType": "python", "relationships": ["main.py"]}

Only respond with the JSON array, no additional text.`;

  try {
    let planResponse;
    if (provider === "gemini") {
      planResponse = await axios.post(
        `${PROVIDERS.gemini.apiUrl}?key=${PROVIDERS.gemini.apiKey}`,
        {
          contents: [
            {
              role: "user",
              parts: [{ text: planPrompt }],
            },
          ],
          generationConfig: {
            temperature: 0.3,
            topP: 0.8,
            topK: 40,
            maxOutputTokens: 8192,
          },
        }
      );
      var planContent =
        planResponse.data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    } else {
      // Use the universal callAI function for other providers
      var planContent = await callAI(planPrompt, provider);
    }

    // Parse execution plan
    const jsonMatch = planContent.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.log("❌ Could not create execution plan");
      return;
    }

    const executionPlan = JSON.parse(jsonMatch[0]);
    console.log(`📋 Execution Plan Created: ${executionPlan.length} steps`);

    // Display plan
    console.log("\n📝 Execution Plan:");
    executionPlan.forEach((step) => {
      console.log(
        `  ${step.step}. ${step.action.toUpperCase()}: ${step.target}`
      );
      console.log(`     → ${step.reasoning}`);
    });

    console.log("\n🚀 Executing plan...\n");

    // Execute each step with retry logic
    const results = [];
    for (const step of executionPlan) {
      console.log(
        `\n▶️  Step ${step.step}: ${step.action.toUpperCase()} ${step.target}`
      );

      let result;
      let retryCount = 0;
      const maxRetries = 2;

      while (retryCount <= maxRetries) {
        try {
          switch (step.action) {
            case "create":
              result = await executeCreateAction(
                step.target,
                step.prompt,
                provider,
                step.projectType || "web",
                step.relationships || []
              );
              break;
            case "delete":
              result = await executeDeleteAction(step.target, provider);
              break;
            case "check":
              result = await executeCheckAction(step.target, provider);
              break;
            case "read":
              result = await executeReadAction(step.target, provider);
              break;
            case "edit":
              result = await executeEditAction(
                step.target,
                step.prompt,
                provider
              );
              break;
            case "rewrite":
              result = await executeRewriteAction(
                step.target,
                step.prompt,
                provider
              );
              break;
            case "errors":
              result = await executeErrorsAction(step.target, provider);
              break;
            case "review":
              result = await executeReviewAction(step.target, provider);
              break;
            case "terminal":
              result = await executeTerminalAction(
                step.target,
                step.prompt,
                provider
              );
              break;
            default:
              result = {
                success: false,
                message: `Unknown action: ${step.action}`,
              };
          }

          // If successful or max retries reached, break the retry loop
          if (result.success || retryCount === maxRetries) {
            break;
          }

          // If failed and retries left, try different approach
          retryCount++;
          if (retryCount <= maxRetries) {
            console.log(
              `🔄 Retry ${retryCount}/${maxRetries}: Trying different approach...`
            );
            memory.addConsoleLog(
              "system",
              `🔄 Retry ${retryCount}/${maxRetries} for step ${step.step}`
            );

            // For directory creation failures, try with explicit directory suffix
            if (
              step.action === "create" &&
              !result.success &&
              !step.target.endsWith("/")
            ) {
              step.target = step.target + "/";
              step.prompt = step.prompt + " (directory)";
            }

            // Wait a moment before retrying
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
        } catch (error) {
          retryCount++;
          if (retryCount > maxRetries) {
            result = { success: false, message: error.message };
            break;
          }
          console.log(`❌ Error on attempt ${retryCount}: ${error.message}`);
          console.log(`🔄 Retrying... (${retryCount}/${maxRetries})`);
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }

      results.push({ step: step.step, action: step.action, result: result });

      // Log command in memory
      memory.addCommand(`${step.action} ${step.target}`, result);

      if (result.success) {
        console.log(`✅ Step ${step.step} completed successfully`);
        memory.addConsoleLog(
          "system",
          `✅ Step ${step.step} completed successfully`
        );
      } else {
        console.log(`❌ Step ${step.step} failed: ${result.message}`);
        memory.addConsoleLog(
          "system",
          `❌ Step ${step.step} failed: ${result.message}`
        );
      }

      // AI Thinking after each step
      await aiThinking(step, result, provider, memory);
    }

    // Generate summary
    console.log("\n" + "=".repeat(50));
    console.log("📊 EXECUTION SUMMARY");
    console.log("=".repeat(50));

    const successful = results.filter((r) => r.result.success).length;
    const failed = results.length - successful;

    console.log(`✅ Successful operations: ${successful}`);
    console.log(`❌ Failed operations: ${failed}`);
    console.log(
      `📈 Success rate: ${Math.round((successful / results.length) * 100)}%`
    );

    console.log("\n🧠 Memory Summary:");
    const memorySummary = memory.getMemorySummary();
    console.log(`   Total entries: ${memorySummary.totalEntries}`);
    console.log(`   Total conversations: ${memorySummary.totalConversations}`);
    console.log(
      `   Total console entries: ${memorySummary.totalConsoleEntries}`
    );
    console.log(`   Total commands: ${memorySummary.totalCommands}`);
    console.log(`   Memory usage: ${memorySummary.memoryUsage}`);

    // Save chat mode execution to memory
    memory.addConversation(
      userInput,
      `Executed ${executionPlan.length} steps`,
      "chat_mode"
    );
    memory.addEntry("chat_mode_summary", {
      userInput: userInput,
      stepsExecuted: executionPlan.length,
      successRate: Math.round((successful / results.length) * 100),
      summary: `Executed ${successful}/${results.length} steps successfully`,
    });
  } catch (error) {
    console.error("❌ Chat mode agent error:", error.message);
    memory.addEntry("error", {
      type: "chat_mode_error",
      message: error.message,
      userInput: userInput,
    });
  }
}

// Enhanced file content generation with better prompts
async function generateFileContent(prompt, target, provider) {
  if (!prompt) return "";
  try {
    const fileExt = path.extname(target).toLowerCase();
    const fileName = path.basename(target);

    // Enhanced system prompt for better code generation
    const systemPrompt = `You are an expert software developer and code architect. Generate high-quality, production-ready code based on the user's requirements.

CRITICAL REQUIREMENTS:
- Generate ONLY the file content, no explanations or markdown code blocks
- Use modern best practices and clean code principles
- Follow proper coding standards and conventions
- Include appropriate error handling where needed
- Add meaningful comments for complex logic
- Ensure code is maintainable and scalable

FILE CONTEXT:
- File name: ${fileName}
- File extension: ${fileExt}
- Target path: ${target}

QUALITY STANDARDS:
- Use semantic naming conventions
- Implement proper error handling
- Follow SOLID principles where applicable
- Include appropriate type annotations (if applicable)
- Optimize for performance and readability
- Add proper documentation/comments

USER REQUEST: ${prompt}

Generate the complete file content following these standards:`;

    const content = await callAI(systemPrompt, provider);

    // Remove code blocks and clean up
    if (typeof content === "string") {
      return content.replace(/```[a-zA-Z]*\n?|```/g, "").trim();
    }
    return content;
  } catch (error) {
    log(
      `Error generating file content with ${PROVIDERS[provider].name}: ${error.message}`,
      "error"
    );
    return "";
  }
}

// Parallel execution system for faster file creation
async function executeMultipleCreations(creationTasks, provider) {
  log(
    `🚀 Executing ${creationTasks.length} creation tasks in parallel`,
    "highlight"
  );

  const results = await Promise.allSettled(
    creationTasks.map(async (task, index) => {
      try {
        log(
          `📝 Creating ${task.target}... (${index + 1}/${
            creationTasks.length
          })`,
          "info"
        );
        const result = await executeCreateAction(
          task.target,
          task.prompt,
          provider,
          task.projectType || "web",
          task.relationships || []
        );
        return { ...result, task };
      } catch (error) {
        return { success: false, message: error.message, task };
      }
    })
  );

  // Process results
  const successful = results.filter(
    (r) => r.status === "fulfilled" && r.value.success
  );
  const failed = results.filter(
    (r) => r.status === "rejected" || !r.value.success
  );

  log(
    `✅ Parallel execution complete: ${successful.length} successful, ${failed.length} failed`,
    "success"
  );

  return {
    successful: successful.map((r) => r.value),
    failed: failed.map((r) =>
      r.status === "fulfilled" ? r.value : { success: false, message: r.reason }
    ),
    summary: `Created ${successful.length}/${results.length} files successfully`,
  };
} // Helper functions for chat mode execution
// Enhanced project-aware file creation with automatic linking and relationships
async function createProjectAwareContent(
  filePath,
  prompt,
  provider,
  projectType = "web",
  relationships = []
) {
  try {
    const fileName = path.basename(filePath);
    const fileExt = path.extname(fileName).toLowerCase();
    const baseName = path.basename(fileName, fileExt);
    const dirPath = path.dirname(filePath);

    // Analyze project context and relationships
    const contextPrompt = `You are an expert developer creating a functional codebase. Generate complete, working code that properly integrates with other files.

PROJECT DETAILS:
- File: ${fileName}
- Extension: ${fileExt}
- Project Type: ${projectType}
- Related Files: ${relationships.join(", ")}
- Directory: ${dirPath}
- Task: ${prompt}

CRITICAL REQUIREMENTS:
1. CREATE FUNCTIONAL CODE: Generate working code, not templates
2. PROPER RELATIONSHIPS: Link/import related files correctly
3. COMPLETE IMPLEMENTATION: Include all necessary functionality
4. BEST PRACTICES: Follow modern coding standards and patterns

PROJECT-SPECIFIC RULES:

WEB PROJECTS (HTML/CSS/JS):
- HTML: Include proper DOCTYPE, link CSS in <head>, include JS before </body>
- CSS: Create responsive, modern styles with proper selectors
- JS: Include proper event handlers, DOM manipulation, functional logic
- Link files: <link rel="stylesheet" href="style.css"> and <script src="script.js">

PYTHON PROJECTS:
- Include proper imports, docstrings, main execution pattern
- Create __init__.py for packages
- Use proper module structure and relative imports

NEXT.JS/REACT:
- Create proper component structure with JSX
- Include necessary imports (React, hooks, etc.)
- Use modern React patterns and best practices

NODE.JS:
- Include proper require/import statements
- Create package.json if needed
- Follow Node.js best practices

GENERATE COMPLETE, FUNCTIONAL CODE for ${fileName}:
- Make it work with the related files: ${relationships.join(", ")}
- Include all necessary imports, links, and dependencies
- Create production-ready code, not just examples
- Ensure the code actually functions as a complete application

Respond with ONLY the complete file contents, no explanations or markdown formatting.`;

    const fileContent = await callAI(contextPrompt, provider);

    // Clean up any markdown formatting that might have leaked through
    const cleanContent = fileContent
      .replace(/^```[a-zA-Z]*\n?/, "")
      .replace(/\n?```$/, "")
      .trim();

    return cleanContent;
  } catch (error) {
    console.error(`Error generating project-aware content: ${error.message}`);
    return generateFallbackContent(filePath, prompt);
  }
}

// Fallback content generator for when AI fails
function generateFallbackContent(filePath, prompt) {
  const fileName = path.basename(filePath);
  const fileExt = path.extname(fileName).toLowerCase();

  switch (fileExt) {
    case ".html":
      return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${path.basename(fileName, fileExt)}</title>
    <link rel="stylesheet" href="style.css">
</head>
<body>
    <div class="container">
        <h1>${path.basename(fileName, fileExt)}</h1>
        <p>Content generated based on: ${prompt}</p>
    </div>
    <script src="script.js"></script>
</body>
</html>`;

    case ".css":
      return `/* ${fileName} - Generated stylesheet */
* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    font-family: 'Arial', sans-serif;
    line-height: 1.6;
    color: #333;
    background-color: #f4f4f4;
}

.container {
    max-width: 1200px;
    margin: 0 auto;
    padding: 20px;
    background: white;
    border-radius: 8px;
    box-shadow: 0 2px 5px rgba(0,0,0,0.1);
}

h1 {
    color: #2c3e50;
    margin-bottom: 20px;
    text-align: center;
}`;

    case ".js":
      return `// ${fileName} - Generated JavaScript
document.addEventListener('DOMContentLoaded', function() {
    console.log('${fileName} loaded successfully');
    
    // Initialize application
    init();
});

function init() {
    // Main application logic
    console.log('Application initialized');
    
    // Add event listeners and functionality here
    setupEventListeners();
}

function setupEventListeners() {
    // Add your event listeners here
    console.log('Event listeners setup complete');
}

// Export for module usage if needed
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { init, setupEventListeners };
}`;

    case ".py":
      return `"""
${fileName} - Generated Python module
${prompt}
"""

def main():
    """Main function for ${fileName}"""
    print(f"Running ${fileName}")
    
    # Add your main logic here
    pass

if __name__ == "__main__":
    main()`;

    default:
      return `// ${fileName}
// Generated content for: ${prompt}

console.log('${fileName} loaded');`;
  }
}

async function executeCreateAction(
  target,
  prompt,
  provider,
  projectType = "web",
  relationships = []
) {
  try {
    // Common file extensions that should NEVER be treated as directories
    const commonFileExtensions = [
      ".html",
      ".css",
      ".js",
      ".json",
      ".txt",
      ".md",
      ".py",
      ".java",
      ".cpp",
      ".c",
      ".php",
      ".rb",
      ".go",
      ".rs",
      ".ts",
      ".jsx",
      ".tsx",
      ".vue",
      ".xml",
      ".yaml",
      ".yml",
      ".sql",
      ".sh",
      ".bat",
      ".ps1",
    ];
    const hasFileExtension = commonFileExtensions.some((ext) =>
      target.toLowerCase().endsWith(ext)
    );

    // If target has no extension but looks like a common file type name, add appropriate extension
    let actualTarget = target;
    if (
      !path.extname(target) &&
      !target.endsWith("/") &&
      !target.endsWith("\\")
    ) {
      const targetLower = target.toLowerCase();
      const baseName = path.basename(targetLower);

      // Auto-add extensions for common file type names
      if (baseName === "css" || baseName.includes("style")) {
        actualTarget = target.includes("/")
          ? target.replace(/css$/i, "style.css")
          : "style.css";
      } else if (
        baseName === "js" ||
        baseName === "javascript" ||
        baseName.includes("script")
      ) {
        actualTarget = target.includes("/")
          ? target.replace(/js$/i, "script.js")
          : "script.js";
      } else if (baseName.includes("html") && !baseName.includes(".html")) {
        actualTarget = target + ".html";
      }
    }

    // Enhanced directory detection - only treat as directory if explicitly indicated
    const isDirectoryRequest =
      target.endsWith("/") ||
      target.endsWith("\\") ||
      target === "." ||
      (!hasFileExtension &&
        !path.extname(actualTarget) &&
        (prompt.toLowerCase().includes("folder") ||
          prompt.toLowerCase().includes("directory") ||
          prompt.toLowerCase().includes("dir") ||
          prompt.toLowerCase().includes("make a directory") ||
          prompt.toLowerCase().includes("create a directory") ||
          prompt.toLowerCase().includes("create a folder")));

    if (isDirectoryRequest) {
      // Create directory
      const dirPath = target.replace(/[\/\\]+$/, ""); // Remove trailing slashes
      const fullDirPath = path.resolve(process.cwd(), dirPath);

      if (!fs.existsSync(fullDirPath)) {
        fs.mkdirSync(fullDirPath, { recursive: true });

        memory.addEntry("directory_created", {
          target: fullDirPath,
          prompt: prompt,
          summary: `Created directory ${path.basename(fullDirPath)}`,
        });

        console.log(`📁 Directory created: ${fullDirPath}`);
        memory.addConsoleLog("system", `📁 Directory created: ${fullDirPath}`);

        return {
          success: true,
          message: `Directory '${fullDirPath}' created successfully`,
          filePath: fullDirPath,
        };
      } else {
        return {
          success: false,
          message: `Directory '${fullDirPath}' already exists`,
        };
      }
    }

    // File creation logic - use actualTarget instead of original target
    const newTarget =
      actualTarget.startsWith("/") || actualTarget.startsWith("\\")
        ? actualTarget.substring(1)
        : actualTarget;
    const targetPath = path.resolve(process.cwd(), newTarget);

    let createPath = targetPath;
    const dir = path.dirname(targetPath);
    const filename = path.basename(targetPath);
    const ext = path.extname(filename);

    if (!ext && fs.existsSync(dir)) {
      const existingFiles = fs
        .readdirSync(dir)
        .filter((f) => fs.statSync(path.join(dir, f)).isFile());
      if (existingFiles.length > 0) {
        const extensions = existingFiles
          .map((f) => path.extname(f))
          .filter((e) => e);
        const extCount = {};
        extensions.forEach((e) => (extCount[e] = (extCount[e] || 0) + 1));
        const mostCommonExt = Object.keys(extCount).reduce(
          (a, b) => (extCount[a] > extCount[b] ? a : b),
          ""
        );

        if (mostCommonExt) {
          createPath = targetPath + mostCommonExt;
        }
      }
    }

    // Use project-aware content generation
    const content = await createProjectAwareContent(
      createPath,
      prompt,
      provider,
      projectType,
      relationships
    );
    const createDir = path.dirname(createPath);
    if (!fs.existsSync(createDir)) {
      fs.mkdirSync(createDir, { recursive: true });
    }

    fs.writeFileSync(createPath, content);

    // Store complete file content in memory using our dedicated method
    memory.storeFile(createPath, content);

    memory.addEntry("file_created", {
      target: createPath,
      size: content.length,
      prompt: prompt,
      projectType: projectType,
      relationships: relationships,
      summary: `Created ${path.basename(createPath)} (${content.length} chars)`,
    });

    console.log(`📄 File created: ${createPath}`);
    memory.addConsoleLog("system", `📄 File created: ${createPath}`);

    // Auto error check after creation
    console.log("🔍 Running automatic error check...");
    const errorCheck = await executeErrorsAction(createPath, provider);
    if (errorCheck.success && !errorCheck.report.includes("NO ERRORS FOUND")) {
      console.log("⚠️ Errors detected in created file:");
      console.log(errorCheck.report);
      memory.addConsoleLog(
        "system",
        `⚠️ Errors detected in ${createPath}: ${errorCheck.report}`
      );
    } else {
      console.log("✅ File created without errors");
      memory.addConsoleLog(
        "system",
        `✅ File created without errors: ${createPath}`
      );
    }

    return {
      success: true,
      message: `File '${createPath}' created successfully`,
      filePath: createPath,
    };
  } catch (error) {
    return { success: false, message: error.message };
  }
}

async function executeDeleteAction(target, provider) {
  try {
    // Check if target is a directory
    const targetPath = path.resolve(process.cwd(), target);

    if (fs.existsSync(targetPath)) {
      const stats = fs.statSync(targetPath);

      if (stats.isDirectory()) {
        // Delete directory and all contents
        fs.rmSync(targetPath, { recursive: true, force: true });

        memory.addEntry("directory_deleted", {
          target: targetPath,
          summary: `Deleted directory ${path.basename(
            targetPath
          )} and all contents`,
        });

        return {
          success: true,
          message: `Directory '${targetPath}' and all contents deleted successfully`,
          filePath: targetPath,
        };
      } else {
        // Delete single file
        fs.unlinkSync(targetPath);

        memory.addEntry("file_deleted", {
          target: targetPath,
          size: stats.size,
          summary: `Deleted ${path.basename(targetPath)}`,
        });

        return {
          success: true,
          message: `File '${targetPath}' deleted successfully`,
          filePath: targetPath,
        };
      }
    }

    // Fallback to fuzzy search for files
    let fuzzy = !path.extname(target);
    const foundPaths = findFiles(target, fuzzy);

    if (foundPaths.length === 1) {
      const deleteFile = foundPaths[0];
      const stats = fs.statSync(deleteFile);
      fs.unlinkSync(deleteFile);

      memory.addEntry("file_deleted", {
        target: deleteFile,
        size: stats.size,
        summary: `Deleted ${path.basename(deleteFile)}`,
      });

      return {
        success: true,
        message: `File '${deleteFile}' deleted successfully`,
        filePath: deleteFile,
      };
    } else if (foundPaths.length > 1) {
      return {
        success: false,
        message: `Multiple files found: ${foundPaths.join(", ")}`,
      };
    } else {
      return {
        success: false,
        message: `File or directory '${target}' not found`,
      };
    }
  } catch (error) {
    return { success: false, message: error.message };
  }
}

async function executeCheckAction(target, provider) {
  try {
    const foundPaths = findFiles(target);

    memory.addEntry("file_checked", {
      target: target,
      found: foundPaths.length,
      paths: foundPaths,
      summary: `Checked ${target} - ${foundPaths.length} files found`,
    });

    if (foundPaths.length > 0) {
      return {
        success: true,
        message: `Found ${foundPaths.length} file(s): ${foundPaths.join(", ")}`,
        files: foundPaths,
      };
    } else {
      return {
        success: true,
        message: `File '${target}' not found`,
        files: [],
      };
    }
  } catch (error) {
    return { success: false, message: error.message };
  }
}

async function executeReadAction(target, provider) {
  try {
    let fuzzy = !path.extname(target);
    const foundPaths = findFiles(target, fuzzy);

    if (foundPaths.length > 0) {
      const filePath = foundPaths[0];
      const fileContents = fs.readFileSync(filePath, "utf-8");

      // Store complete file content in memory buffer for full context
      memory.storeFile(filePath, fileContents);

      console.log(
        `📖 File content stored in memory: ${path.basename(filePath)}`
      );
      memory.addConsoleLog(
        "system",
        `📖 Full file content stored in memory: ${filePath}`
      );

      return {
        success: true,
        message: `Read file '${filePath}' and stored complete content in memory`,
        content: fileContents,
        filePath: filePath,
      };
    } else {
      return { success: false, message: `File '${target}' not found` };
    }
  } catch (error) {
    return { success: false, message: error.message };
  }
}

async function executeEditAction(target, prompt, provider) {
  try {
    let fuzzy = !path.extname(target);
    let filePath, originalContent;

    // First, try to get file content from memory
    const memoryFile = memory.getFileFromMemory(target);

    if (memoryFile.found) {
      console.log(
        `🧠 Using file from memory: ${path.basename(memoryFile.filePath)}`
      );
      filePath = memoryFile.filePath;
      originalContent = memoryFile.content;
      memory.addConsoleLog(
        "system",
        `🧠 Retrieved file from memory: ${filePath}`
      );
    } else {
      // Fallback to finding and reading from disk
      const foundPaths = findFiles(target, fuzzy);

      if (foundPaths.length > 0) {
        filePath = foundPaths[0];
        originalContent = fs.readFileSync(filePath, "utf-8");
        console.log(`💾 Reading file from disk: ${path.basename(filePath)}`);
        memory.addConsoleLog(
          "system",
          `💾 Reading file from disk: ${filePath}`
        );
      } else {
        return { success: false, message: `File '${target}' not found` };
      }
    }

    // Create a modified editFileContent function that uses the provided content
    const changeContent = await editFileContentFromMemory(
      filePath,
      originalContent,
      prompt,
      provider
    );

    if (changeContent) {
      applyContextChanges(filePath, changeContent);
      const newContent = fs.readFileSync(filePath, "utf-8");

      // Update memory with the new content
      memory.addEntry("file_edited", {
        target: filePath,
        prompt: prompt,
        originalSize: originalContent.length,
        newSize: newContent.length,
        changes: changeContent,
        content: newContent, // Store updated content in memory
        extension: path.extname(filePath),
        lastModified: new Date().toISOString(),
        summary: `Edited ${path.basename(filePath)} - ${prompt}`,
      });

      console.log(`✏️ File edited: ${filePath}`);
      memory.addConsoleLog("system", `✏️ File edited: ${filePath}`);

      // Auto error check after editing
      console.log("🔍 Running automatic error check...");
      const errorCheck = await executeErrorsAction(filePath, provider);
      if (
        errorCheck.success &&
        !errorCheck.report.includes("NO ERRORS FOUND")
      ) {
        console.log("⚠️ Errors detected after editing:");
        console.log(errorCheck.report);
        memory.addConsoleLog(
          "system",
          `⚠️ Errors detected in ${filePath}: ${errorCheck.report}`
        );
      } else {
        console.log("✅ File edited without errors");
        memory.addConsoleLog(
          "system",
          `✅ File edited without errors: ${filePath}`
        );
      }

      return {
        success: true,
        message: `File '${filePath}' edited successfully`,
        filePath: filePath,
      };
    } else {
      return { success: false, message: "No changes suggested by AI" };
    }
  } catch (error) {
    return { success: false, message: error.message };
  }
}

async function executeRewriteAction(target, prompt, provider) {
  try {
    let fuzzy = !path.extname(target);
    let filePath, originalContent;

    // First, try to get file content from memory
    const memoryFile = memory.getFileFromMemory(target);

    if (memoryFile.found) {
      console.log(
        `🧠 Using file from memory: ${path.basename(memoryFile.filePath)}`
      );
      filePath = memoryFile.filePath;
      originalContent = memoryFile.content;
      memory.addConsoleLog(
        "system",
        `🧠 Retrieved file from memory for rewrite: ${filePath}`
      );
    } else {
      // Fallback to finding and reading from disk
      const foundPaths = findFiles(target, fuzzy);

      if (foundPaths.length > 0) {
        filePath = foundPaths[0];
        originalContent = fs.readFileSync(filePath, "utf-8");
        console.log(
          `💾 Reading file from disk for rewrite: ${path.basename(filePath)}`
        );
        memory.addConsoleLog(
          "system",
          `💾 Reading file from disk for rewrite: ${filePath}`
        );
      } else {
        return { success: false, message: `File '${target}' not found` };
      }
    }

    // Create enhanced rewrite function that uses provided content
    const newContent = await rewriteFileContentFromMemory(
      filePath,
      originalContent,
      prompt,
      provider
    );

    if (newContent) {
      fs.writeFileSync(filePath, newContent);

      // Store updated file in memory
      memory.storeFile(filePath, newContent);

      // Update memory with the new content
      memory.addEntry("file_rewritten", {
        target: filePath,
        prompt: prompt,
        originalContent: originalContent,
        originalSize: originalContent.length,
        newSize: newContent.length,
        content: newContent, // Store updated content in memory
        extension: path.extname(filePath),
        lastModified: new Date().toISOString(),
        summary: `Rewritten ${path.basename(filePath)} - ${prompt}`,
      });

      console.log(`🔄 File rewritten: ${filePath}`);
      memory.addConsoleLog("system", `🔄 File rewritten: ${filePath}`);

      return {
        success: true,
        message: `File '${filePath}' completely rewritten`,
        filePath: filePath,
      };
    } else {
      return { success: false, message: "No new content generated by AI" };
    }
  } catch (error) {
    return { success: false, message: error.message };
  }
}

async function executeErrorsAction(target, provider) {
  try {
    let fuzzy = !path.extname(target);
    let filePath, fileContents;

    // First, try to get file content from memory
    const memoryFile = memory.getFileFromMemory(target);

    if (memoryFile.found) {
      console.log(
        `🧠 Using file from memory for error check: ${path.basename(
          memoryFile.filePath
        )}`
      );
      filePath = memoryFile.filePath;
      fileContents = memoryFile.content;
      memory.addConsoleLog(
        "system",
        `🧠 Retrieved file from memory for error check: ${filePath}`
      );
    } else {
      // Fallback to finding and reading from disk
      const foundPaths = findFiles(target, fuzzy);

      if (foundPaths.length > 0) {
        filePath = foundPaths[0];
        fileContents = fs.readFileSync(filePath, "utf-8");
        console.log(
          `💾 Reading file from disk for error check: ${path.basename(
            filePath
          )}`
        );
      } else {
        return { success: false, message: `File '${target}' not found` };
      }
    }

    // Use content directly instead of reading from file again
    const errorReport = await checkFileErrorsFromMemory(
      filePath,
      fileContents,
      provider
    );

    memory.addEntry("file_error_check", {
      target: filePath,
      report: errorReport,
      hasErrors: !errorReport.includes("NO ERRORS FOUND"),
      summary: `Error check for ${path.basename(filePath)}`,
    });

    return {
      success: true,
      message: `Error check completed for '${filePath}'`,
      report: errorReport,
      filePath: filePath,
    };
  } catch (error) {
    return { success: false, message: error.message };
  }
}

async function executeReviewAction(target, provider) {
  try {
    let fuzzy = !path.extname(target);
    const foundPaths = findFiles(target, fuzzy);

    if (foundPaths.length > 0) {
      const filePath = foundPaths[0];

      // Check if file content is available in memory
      const fileFromMemory = memory.getFileFromMemory(filePath);
      let originalContent;
      let reviewResult;

      if (fileFromMemory) {
        console.log(
          `📋 Using file content from memory for review: ${path.basename(
            filePath
          )}`
        );
        originalContent = fileFromMemory.content;
        reviewResult = await reviewFileContentFromMemory(
          filePath,
          originalContent,
          provider
        );
      } else {
        console.log(
          `💾 Reading file from disk for review: ${path.basename(filePath)}`
        );
        originalContent = fs.readFileSync(filePath, "utf-8");
        reviewResult = await reviewAndImproveFile(filePath, provider);
      }

      // Extract improved code if present
      const improvedCodeMatch = reviewResult.match(
        /IMPROVED_CODE:\s*([\s\S]*)/
      );
      if (improvedCodeMatch) {
        const improvedCode = improvedCodeMatch[1]
          .replace(/```[a-zA-Z]*\n?|```/g, "")
          .trim();

        // Apply improvements
        fs.writeFileSync(filePath, improvedCode);

        // Update memory with new content
        memory.storeFile(filePath, improvedCode);

        memory.addEntry("file_reviewed", {
          target: filePath,
          originalSize: originalContent.length,
          newSize: improvedCode.length,
          review: reviewResult,
          summary: `AI review and improvement of ${path.basename(filePath)}`,
          usedMemory: !!fileFromMemory,
        });

        return {
          success: true,
          message: `File '${filePath}' reviewed and improved`,
          filePath: filePath,
          review: reviewResult,
        };
      } else {
        memory.addEntry("file_reviewed", {
          target: filePath,
          review: reviewResult,
          summary: `AI review of ${path.basename(
            filePath
          )} (no improvements applied)`,
          usedMemory: !!fileFromMemory,
        });

        return {
          success: true,
          message: `File '${filePath}' reviewed`,
          filePath: filePath,
          review: reviewResult,
        };
      }
    } else {
      return { success: false, message: `File '${target}' not found` };
    }
  } catch (error) {
    return { success: false, message: error.message };
  }
}

// AI Terminal Command Execution
async function executeTerminalAction(command, prompt, provider) {
  try {
    console.log(`🖥️  Executing terminal command: ${command}`);
    memory.addConsoleLog("system", `🖥️ Executing terminal command: ${command}`);

    // AI decides what terminal command to run
    const terminalPrompt = `You are an AI assistant that generates terminal commands based on a user request.

User Request: "${prompt}"
Suggested Command: "${command}"

Based on the user request, generate the exact terminal command that should be executed.
Consider common commands like:
- npm run build, npm run dev, npm start
- node ., node index.js
- python script.py
- git commands
- file operations (ls, dir, cp, mv, etc.)

Respond with ONLY the terminal command, no explanations or additional text.
If the suggested command looks good, use it. Otherwise, generate a better one.`;

    const terminalCommand = await callAI(terminalPrompt, provider);
    console.log(`💻 AI Suggested Command: ${terminalCommand}`);

    // Execute the command
    const isWindows = process.platform === "win32";
    const shell = isWindows ? "cmd" : "bash";
    const shellFlag = isWindows ? "/c" : "-c";

    return new Promise((resolve) => {
      const child = spawn(shell, [shellFlag, terminalCommand], {
        cwd: process.cwd(),
        stdio: ["pipe", "pipe", "pipe"],
      });

      let output = "";
      let errorOutput = "";
      let resolved = false;

      // Check if this is a Windows GUI command that should resolve quickly
      const isWindowsGUICommand =
        isWindows &&
        (terminalCommand.toLowerCase().includes("explorer") ||
          terminalCommand.toLowerCase().includes("notepad") ||
          terminalCommand.toLowerCase().includes("calc") ||
          terminalCommand.toLowerCase().includes("mspaint") ||
          terminalCommand.toLowerCase().includes("start "));

      // For GUI commands, resolve after a short delay since they launch in background
      if (isWindowsGUICommand) {
        setTimeout(() => {
          if (!resolved) {
            resolved = true;
            memory.addEntry("terminal_command", {
              command: terminalCommand,
              exitCode: 0,
              output: "GUI application launched successfully",
              error: "",
              success: true,
              isGUICommand: true,
              summary: `Terminal: ${terminalCommand} (GUI launched)`,
            });

            console.log(
              `✅ GUI Command launched successfully: ${terminalCommand}`
            );
            memory.addConsoleLog(
              "system",
              `✅ GUI Command launched: ${terminalCommand}`
            );

            resolve({
              success: true,
              message: `GUI application launched successfully: ${terminalCommand}`,
              output: "GUI application launched successfully",
              error: "",
              command: terminalCommand,
              isGUICommand: true,
            });
          }
        }, 1000); // Wait 1 second for GUI apps to launch
      }

      child.stdout.on("data", (data) => {
        const text = data.toString();
        output += text;
        console.log(text);
        memory.addConsoleLog("output", text.trim());
      });

      child.stderr.on("data", (data) => {
        const text = data.toString();
        errorOutput += text;
        console.error(text);
        memory.addConsoleLog("error", text.trim());
      });

      child.on("close", (code) => {
        if (resolved) return; // Already resolved for GUI commands

        // Special handling for Windows GUI applications that return non-zero exit codes but are successful
        const isWindowsGUICommand =
          isWindows &&
          (terminalCommand.toLowerCase().includes("explorer") ||
            terminalCommand.toLowerCase().includes("notepad") ||
            terminalCommand.toLowerCase().includes("calc") ||
            terminalCommand.toLowerCase().includes("mspaint") ||
            terminalCommand.toLowerCase().includes("start "));

        // For GUI commands, consider them successful if they launch (even with exit code 1)
        // For other commands, use standard exit code logic
        const success = isWindowsGUICommand ? true : code === 0;

        const message = success
          ? `Command executed successfully: ${terminalCommand}${
              isWindowsGUICommand && code !== 0
                ? " (GUI application launched)"
                : ""
            }`
          : `Command failed with code ${code}: ${terminalCommand}`;

        memory.addEntry("terminal_command", {
          command: terminalCommand,
          exitCode: code,
          output: output,
          error: errorOutput,
          success: success,
          isGUICommand: isWindowsGUICommand,
          summary: `Terminal: ${terminalCommand} (${
            success ? "success" : "failed"
          })`,
        });

        console.log(`${success ? "✅" : "❌"} ${message}`);
        memory.addConsoleLog("system", `${success ? "✅" : "❌"} ${message}`);

        resolved = true;
        resolve({
          success: success,
          message: message,
          output: output,
          error: errorOutput,
          command: terminalCommand,
          isGUICommand: isWindowsGUICommand,
        });
      });

      child.on("error", (error) => {
        const message = `Failed to execute command: ${error.message}`;
        console.error(`❌ ${message}`);
        memory.addConsoleLog("error", message);

        resolve({
          success: false,
          message: message,
          error: error.message,
          command: terminalCommand,
        });
      });
    });
  } catch (error) {
    return {
      success: false,
      message: `Terminal execution error: ${error.message}`,
    };
  }
}

async function main() {
  console.log("🤖 Welcome to AI File Assistant with Advanced Features!");
  console.log(
    "� Features: Error Checking, Memory System, Chat Agent, AI Review\n"
  );

  const memory = new MemoryBuffer();

  const { provider } = await inquirer.prompt([
    {
      type: "list",
      name: "provider",
      message: "Choose your AI provider:",
      choices: [
        { name: "🦙 Ollama (Local - No API Key)", value: "ollama" },
        { name: "✨ Gemini (Google)", value: "gemini" },
        { name: "🌟 Mistral (Cloud)", value: "mistral" },
        { name: "🤖 OpenAI (ChatGPT)", value: "openai" },
        { name: "🧠 Claude (Anthropic)", value: "claude" },
      ],
    },
  ]);

  // Prompt for API key if required
  if (PROVIDERS[provider].requiresApiKey) {
    const { apiKey } = await inquirer.prompt([
      {
        type: "password",
        name: "apiKey",
        message: `Enter your ${PROVIDERS[provider].name} API key:`,
        mask: "*",
        validate: (input) => {
          if (!input || input.trim() === "") {
            return "API key is required for this provider";
          }
          return true;
        },
      },
    ]);
    PROVIDERS[provider].apiKey = apiKey.trim();
    console.log(`✅ API key configured for ${PROVIDERS[provider].name}`);
  }

  // Model selection
  const modelChoices = PROVIDERS[provider].models.map((model) => ({
    name:
      model === "custom"
        ? `${colors.warning}🔧 Custom Model${colors.reset}`
        : `${PROVIDERS[provider].color}${model}${colors.reset}`,
    value: model,
  }));

  const { selectedModel } = await inquirer.prompt([
    {
      type: "list",
      name: "selectedModel",
      message: `${colors.highlight}Choose model for ${PROVIDERS[provider].name}:${colors.reset}`,
      choices: modelChoices,
      default:
        PROVIDERS[provider].selectedModel || PROVIDERS[provider].defaultModel,
    },
  ]);

  // Handle custom model input
  if (selectedModel === "custom") {
    const { customModel } = await inquirer.prompt([
      {
        type: "input",
        name: "customModel",
        message: `${colors.primary}Enter custom model name:${colors.reset}`,
        validate: (input) => (input.trim() ? true : "Model name is required"),
      },
    ]);
    PROVIDERS[provider].selectedModel = customModel.trim();
  } else {
    PROVIDERS[provider].selectedModel = selectedModel;
  }

  // Save the configuration
  updateProviderConfig(
    provider,
    PROVIDERS[provider].apiKey,
    PROVIDERS[provider].selectedModel
  );

  console.log(
    `${colors.success}✅ Model configured: ${PROVIDERS[provider].selectedModel}${colors.reset}`
  );

  // Mode selection
  const { mode } = await inquirer.prompt([
    {
      type: "list",
      name: "mode",
      message: "Choose your interaction mode:",
      choices: [
        { name: "🤖 Agent Mode (AI Planning & Execution)", value: "agent" },
        { name: "💬 Chat Mode (Conversational)", value: "chat" },
        { name: "⚡ Command Mode (Direct Commands)", value: "command" },
      ],
    },
  ]);

  console.log(
    `\n🎯 Running in ${mode.toUpperCase()} mode with ${
      PROVIDERS[provider].name
    }`
  );
  console.log("📝 Memory system activated - all actions will be logged");
  console.log("🔍 Error checking enabled for all operations\n");

  if (mode === "agent") {
    await runAgentMode(provider, memory);
  } else if (mode === "chat") {
    await runChatMode(provider, memory);
  } else {
    await runCommandMode(provider, memory);
  }
}

async function runAgentMode(provider, memory) {
  console.log("🤖 AGENT MODE: AI will plan and execute complex tasks for you");
  console.log(
    "Type your high-level requests and let the AI break them down!\n"
  );

  while (true) {
    const { input } = await inquirer.prompt([
      {
        type: "input",
        name: "input",
        message:
          "🎯 What task would you like me to accomplish? (type 'exit' to quit, 'memory' to view memory):",
      },
    ]);

    if (input.toLowerCase() === "exit") {
      console.log("👋 Goodbye!");
      break;
    }

    if (input.toLowerCase() === "memory") {
      displayMemorySummary(memory);
      continue;
    }

    // Use the intelligent chat agent for planning and execution
    await showLoadingAnimation("🤖 AI Planning...", async () => {
      await chatModeAgent(input, provider, memory);
    });
    console.log("\n" + "=".repeat(60));
  }
}

async function runChatMode(provider, memory) {
  console.log("💬 CHAT MODE: Conversational interaction with the AI assistant");
  console.log("Chat naturally and specify what you need!\n");

  while (true) {
    const { input } = await inquirer.prompt([
      {
        type: "input",
        name: "input",
        message:
          "💬 Chat with me: (type 'exit' to quit, 'memory' to view memory):",
      },
    ]);

    if (input.toLowerCase() === "exit") {
      console.log("👋 Goodbye!");
      break;
    }

    if (input.toLowerCase() === "memory") {
      displayMemorySummary(memory);
      continue;
    }

    // Use chat mode for conversational interactions
    await showLoadingAnimation("💬 Processing...", async () => {
      await chatModeAgent(input, provider, memory);
    });
    console.log("\n" + "=".repeat(60));
  }
}

async function runCommandMode(provider, memory) {
  console.log("⚡ COMMAND MODE: Direct command execution");
  console.log("Use specific commands like 'create', 'edit', 'delete', etc.\n");

  while (true) {
    const { action } = await inquirer.prompt([
      {
        type: "list",
        name: "action",
        message: "Choose an action:",
        choices: [
          { name: "📝 Create file/folder", value: "create" },
          { name: "✏️ Edit file", value: "edit" },
          { name: "🔄 Rewrite file", value: "rewrite" },
          { name: "🗑️ Delete file/folder", value: "delete" },
          { name: "🔍 Check/Review file", value: "check" },
          { name: "🤖 AI Review & Improve", value: "review" },
          { name: "🧠 View Memory", value: "memory" },
          { name: "🔎 Search in Memory", value: "search" },
          { name: "📖 Get File from Memory", value: "getfile" },
          { name: "💾 Store Current Files in Memory", value: "storefiles" },
          { name: "🚪 Exit", value: "exit" },
        ],
      },
    ]);

    if (action === "exit") {
      console.log("👋 Goodbye!");
      break;
    }

    if (action === "memory") {
      displayMemorySummary(memory);
      continue;
    }

    if (action === "search") {
      const { searchText } = await inquirer.prompt([
        {
          type: "input",
          name: "searchText",
          message: "Enter text to search in stored files:",
        },
      ]);

      const searchResults = memory.searchInStoredFiles(searchText);
      if (searchResults.length > 0) {
        console.log(
          `\n🔍 Found "${searchText}" in ${searchResults.length} file(s):`
        );
        searchResults.forEach((result, i) => {
          console.log(
            `\n${i + 1}. ${colors.primary}${result.filename}${colors.reset} (${
              result.matches
            } matches):`
          );
          result.matchingLines.forEach((match) => {
            console.log(
              `   Line ${match.lineNumber}: ${colors.dim}${match.content}${colors.reset}`
            );
          });
        });
      } else {
        console.log(
          `\n❌ No matches found for "${searchText}" in stored files`
        );
      }
      continue;
    }

    if (action === "getfile") {
      const storedFiles = memory.getAllFilesInMemory();
      if (storedFiles.length === 0) {
        console.log("\n❌ No files currently stored in memory");
        continue;
      }

      const { selectedFile } = await inquirer.prompt([
        {
          type: "list",
          name: "selectedFile",
          message: "Select file to retrieve from memory:",
          choices: storedFiles.map((file) => ({
            name: `${file.filename} (${file.size} chars, ${file.lines} lines)`,
            value: file.filename,
          })),
        },
      ]);

      const fileData = memory.getFileFromMemory(selectedFile);
      if (fileData.found) {
        console.log(
          `\n📖 File: ${colors.primary}${fileData.filePath}${colors.reset}`
        );
        console.log(
          `📊 Size: ${fileData.size} characters, ${fileData.lines} lines`
        );
        console.log(
          `🕒 Last read: ${new Date(fileData.lastRead).toLocaleString()}`
        );
        console.log(
          `\n📄 Content:\n${colors.dim}${"=".repeat(50)}${colors.reset}`
        );
        console.log(fileData.content);
        console.log(`${colors.dim}${"=".repeat(50)}${colors.reset}`);
      } else {
        console.log(`\n❌ ${fileData.message}`);
      }
      continue;
    }

    if (action === "storefiles") {
      // Find all files in the workspace to store in memory
      const ignorePatterns = [
        "node_modules",
        ".git",
        ...getGitignorePatterns(),
      ];

      let fileCount = 0;

      // Recursive function to find and store all files
      const storeFilesInDirectory = (dirPath) => {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(dirPath, entry.name);

          // Skip ignored directories and files
          if (
            ignorePatterns.some(
              (pattern) =>
                entry.name === pattern ||
                fullPath.includes(`/${pattern}/`) ||
                fullPath.includes(`\\${pattern}\\`)
            )
          ) {
            continue;
          }

          if (entry.isDirectory()) {
            storeFilesInDirectory(fullPath);
          } else if (entry.isFile()) {
            try {
              // Store the file content in memory
              const content = fs.readFileSync(fullPath, "utf-8");
              memory.storeFile(fullPath, content);
              fileCount++;
            } catch (error) {
              console.log(
                `${colors.error}Error reading ${fullPath}: ${error.message}${colors.reset}`
              );
            }
          }
        }
      };

      console.log(
        `${colors.primary}💾 Storing current files in memory...${colors.reset}`
      );
      storeFilesInDirectory(process.cwd());
      console.log(
        `${colors.success}✅ Stored ${fileCount} files in memory${colors.reset}`
      );
      continue;
    }

    // Get target and prompt based on action
    let target, prompt, result;

    switch (action) {
      case "create":
        const createDetails = await inquirer.prompt([
          {
            type: "input",
            name: "target",
            message: "Enter file/folder path to create:",
          },
          {
            type: "input",
            name: "prompt",
            message: "Describe what to create:",
          },
        ]);
        result = await showLoadingAnimation("📝 Creating...", async () => {
          return await executeCreateAction(
            createDetails.target,
            createDetails.prompt,
            provider,
            "web", // Default project type for command mode
            [] // No relationships info in command mode
          );
        });
        break;

      case "edit":
        const editDetails = await inquirer.prompt([
          {
            type: "input",
            name: "target",
            message: "Enter file to edit:",
          },
          {
            type: "input",
            name: "prompt",
            message: "Describe the changes:",
          },
        ]);
        result = await showLoadingAnimation("✏️ Editing...", async () => {
          return await executeEditAction(
            editDetails.target,
            editDetails.prompt,
            provider
          );
        });
        break;

      case "rewrite":
        const rewriteDetails = await inquirer.prompt([
          {
            type: "input",
            name: "target",
            message: "Enter file to rewrite:",
          },
          {
            type: "input",
            name: "prompt",
            message: "Describe how to rewrite:",
          },
        ]);
        result = await showLoadingAnimation("🔄 Rewriting...", async () => {
          return await executeRewriteAction(
            rewriteDetails.target,
            rewriteDetails.prompt,
            provider
          );
        });
        break;

      case "delete":
        const deleteDetails = await inquirer.prompt([
          {
            type: "input",
            name: "target",
            message: "Enter file/folder to delete:",
          },
        ]);
        result = await showLoadingAnimation("🗑️ Deleting...", async () => {
          return await executeDeleteAction(deleteDetails.target, provider);
        });
        break;

      case "check":
        const checkDetails = await inquirer.prompt([
          {
            type: "input",
            name: "target",
            message: "Enter file to check:",
          },
        ]);
        result = await showLoadingAnimation("🔍 Checking...", async () => {
          return await executeCheckAction(checkDetails.target, provider);
        });
        break;

      case "review":
        const reviewDetails = await inquirer.prompt([
          {
            type: "input",
            name: "target",
            message: "Enter file to review and improve:",
          },
        ]);
        result = await showLoadingAnimation("🤖 AI Reviewing...", async () => {
          return await executeReviewAction(reviewDetails.target, provider);
        });
        break;
    }

    if (result) {
      console.log(`\n${result.success ? "✅" : "❌"} ${result.message}`);

      // AI Summary/Decision after each operation
      if (result.success) {
        await generateAISummary(action, result, provider, memory);
      }
    }

    console.log("\n" + "=".repeat(60));
  }
}

function displayMemorySummary(memory) {
  console.log("\n🧠 MEMORY SUMMARY");
  console.log("=".repeat(40));
  const summary = memory.getMemorySummary();
  console.log(`Total entries: ${summary.totalEntries}`);
  console.log(`Total conversations: ${summary.totalConversations}`);
  console.log(`Total console entries: ${summary.totalConsoleEntries}`);
  console.log(`Total commands executed: ${summary.totalCommands}`);
  console.log(`Memory usage: ${summary.memoryUsage}`);

  // Show stored files in memory
  const storedFiles = memory.getAllFilesInMemory();
  if (storedFiles.length > 0) {
    console.log(`\n📁 Files stored in memory (${storedFiles.length}):`);
    storedFiles.forEach((file, i) => {
      const contentPreview = file.content
        ? file.content.substring(0, 50).replace(/\n/g, " ") +
          (file.content.length > 50 ? "..." : "")
        : "No content";

      console.log(
        `  ${i + 1}. ${file.filename} (${file.size} chars, ${
          file.lines
        } lines) - ${file.extension || "no ext"}`
      );
      console.log(`     Preview: "${contentPreview}"`);
    });
  } else {
    console.log("\n📁 No files currently stored in memory");
  }

  console.log("\nRecent actions:");
  summary.recentActions.forEach((action, i) => {
    console.log(`  ${i + 1}. ${action}`);
  });

  console.log("\nRecent commands:");
  summary.recentCommands.forEach((command, i) => {
    console.log(`  ${i + 1}. ${command}`);
  });

  console.log("\nRecent console history:");
  const recentConsole = memory.getConsoleHistory(5);
  recentConsole.forEach((entry, i) => {
    console.log(
      `  ${i + 1}. [${entry.type}] ${entry.message.substring(0, 80)}${
        entry.message.length > 80 ? "..." : ""
      }`
    );
  });
}

main();

// API Key Management Interface
async function manageApiKeys() {
  const config = loadConfig();

  console.log(`${colors.primary}${colors.bold}
  ╔══════════════════════════════════════╗
  ║          🔑 API Key Manager          ║
  ╚══════════════════════════════════════╝${colors.reset}`);

  const { action } = await inquirer.prompt([
    {
      type: "list",
      name: "action",
      message: `${colors.highlight}What would you like to do?${colors.reset}`,
      choices: [
        {
          name: `${colors.success}➕ Add/Update API Key${colors.reset}`,
          value: "add",
        },
        {
          name: `${colors.info}👁️  View Saved Keys${colors.reset}`,
          value: "view",
        },
        {
          name: `${colors.error}🗑️  Remove API Key${colors.reset}`,
          value: "remove",
        },
        {
          name: `${colors.warning}🔄 Back to Main Menu${colors.reset}`,
          value: "back",
        },
      ],
    },
  ]);

  if (action === "back") return;

  if (action === "view") {
    console.log(`\n${colors.info}📋 Saved API Keys:${colors.reset}`);
    for (const [provider, settings] of Object.entries(config.providers || {})) {
      const hasKey = settings.apiKey ? "✅" : "❌";
      console.log(
        `  ${hasKey} ${PROVIDERS[provider]?.name || provider}: ${
          settings.apiKey ? "***hidden***" : "Not set"
        }`
      );
    }
    console.log();
    return manageApiKeys();
  }

  const { providerChoice } = await inquirer.prompt([
    {
      type: "list",
      name: "providerChoice",
      message: `${colors.highlight}Select provider:${colors.reset}`,
      choices: Object.keys(PROVIDERS)
        .filter((p) => PROVIDERS[p].requiresApiKey)
        .map((p) => ({
          name: `${PROVIDERS[p].color}${PROVIDERS[p].name}${colors.reset}`,
          value: p,
        })),
    },
  ]);

  if (action === "add") {
    const { apiKey } = await inquirer.prompt([
      {
        type: "password",
        name: "apiKey",
        message: `${PROVIDERS[providerChoice].color}Enter API key for ${PROVIDERS[providerChoice].name}:${colors.reset}`,
        mask: "*",
      },
    ]);

    updateProviderConfig(
      providerChoice,
      apiKey,
      PROVIDERS[providerChoice].selectedModel ||
        PROVIDERS[providerChoice].defaultModel
    );
    log(`✅ API key saved for ${PROVIDERS[providerChoice].name}`, "success");
  } else if (action === "remove") {
    updateProviderConfig(
      providerChoice,
      null,
      PROVIDERS[providerChoice].defaultModel
    );
    log(`🗑️ API key removed for ${PROVIDERS[providerChoice].name}`, "warning");
  }

  return manageApiKeys();
}

// New Parallel Mode for high-speed file creation
async function runParallelMode(provider, memory) {
  console.log(
    `${colors.info}${colors.bold}🔥 PARALLEL MODE: High-Speed File Creation${colors.reset}`
  );
  console.log(
    `${colors.dim}Create multiple files simultaneously for maximum efficiency!${colors.reset}\n`
  );

  const { creationMethod } = await inquirer.prompt([
    {
      type: "list",
      name: "creationMethod",
      message: `${colors.highlight}How would you like to create files?${colors.reset}`,
      choices: [
        {
          name: `${colors.success}📝 Bulk File Creation${colors.reset} ${colors.dim}(Multiple files at once)${colors.reset}`,
          value: "bulk",
        },
        {
          name: `${colors.primary}🎯 Project Template${colors.reset} ${colors.dim}(Pre-defined structures)${colors.reset}`,
          value: "template",
        },
        {
          name: `${colors.warning}🔄 Back to Mode Selection${colors.reset}`,
          value: "back",
        },
      ],
    },
  ]);

  if (creationMethod === "back") return main();

  if (creationMethod === "bulk") {
    const { fileList } = await inquirer.prompt([
      {
        type: "input",
        name: "fileList",
        message: `${colors.primary}Enter files to create (comma-separated):${colors.reset}\n${colors.dim}Example: index.html, style.css, script.js${colors.reset}`,
        validate: (input) =>
          input.trim() ? true : "Please enter at least one file",
      },
    ]);

    const { description } = await inquirer.prompt([
      {
        type: "input",
        name: "description",
        message: `${colors.secondary}Describe the project/purpose:${colors.reset}`,
        default: "Web application files",
      },
    ]);

    const files = fileList
      .split(",")
      .map((f) => f.trim())
      .filter((f) => f);
    const creationTasks = files.map((file) => ({
      target: file,
      prompt: `Create a ${file} file for ${description}. Follow modern best practices and include proper structure, comments, and error handling.`,
    }));

    log(
      `🚀 Starting parallel creation of ${files.length} files...`,
      "highlight"
    );

    const results = await showLoadingAnimation(
      `Creating ${files.length} files in parallel...`,
      () => executeMultipleCreations(creationTasks, provider),
      colors.info
    );

    console.log(
      `\n${colors.success}${colors.bold}📊 PARALLEL EXECUTION SUMMARY${colors.reset}`
    );
    console.log(
      `${colors.dim}═══════════════════════════════════════${colors.reset}`
    );
    console.log(
      `${colors.success}✅ Successful: ${results.successful.length}${colors.reset}`
    );
    console.log(
      `${colors.error}❌ Failed: ${results.failed.length}${colors.reset}`
    );
    console.log(
      `${colors.info}📈 Success Rate: ${Math.round(
        (results.successful.length /
          (results.successful.length + results.failed.length)) *
          100
      )}%${colors.reset}`
    );

    if (results.failed.length > 0) {
      console.log(`\n${colors.error}Failed files:${colors.reset}`);
      results.failed.forEach((f) =>
        console.log(
          `  ${colors.error}❌ ${f.task?.target || "Unknown"}: ${f.message}${
            colors.reset
          }`
        )
      );
    }
  }

  // Continue in parallel mode
  const { continueChoice } = await inquirer.prompt([
    {
      type: "confirm",
      name: "continueChoice",
      message: `${colors.highlight}Would you like to create more files?${colors.reset}`,
      default: true,
    },
  ]);

  if (continueChoice) {
    return runParallelMode(provider, memory);
  }
}
