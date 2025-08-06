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
    streamUrl: "http://localhost:11434/api/chat",
    models: [
      "llama3.2:3b",
      "llama3.1:8b",
      "codellama:7b",
      "qwen2.5-coder:7b",
      "custom",
    ],
    defaultModel: "qwen2.5-coder:7b",
    requiresApiKey: false,
    color: colors.info,
  },
  mistral: {
    name: "Mistral",
    apiUrl: "https://api.mistral.ai/v1/chat/completions",
    streamUrl: "https://api.mistral.ai/v1/chat/completions",
    models: [
      "mistral-tiny",
      "mistral-small",
      "mistral-medium",
      "mistral-large-latest",
      "codestral-latest",
      "custom",
    ],
    defaultModel: "mistral-small",
    requiresApiKey: true,
    apiKey: null,
    color: colors.primary,
  },
  openai: {
    name: "OpenAI",
    apiUrl: "https://api.openai.com/v1/chat/completions",
    streamUrl: "https://api.openai.com/v1/chat/completions",
    models: [
      "gpt-4",
      "gpt-4-turbo",
      "gpt-3.5-turbo",
      "gpt-4o",
      "o1-preview",
      "custom",
    ],
    defaultModel: "gpt-4o",
    requiresApiKey: true,
    apiKey: null,
    color: colors.success,
  },
  claude: {
    name: "Claude",
    apiUrl: "https://api.anthropic.com/v1/messages",
    streamUrl: "https://api.anthropic.com/v1/messages",
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
  google: {
    name: "Google Gemini",
    apiUrl: "https://generativelanguage.googleapis.com/v1beta/models",
    streamUrl: "https://generativelanguage.googleapis.com/v1beta/models",
    models: ["gemini-1.5-pro", "gemini-1.5-flash", "gemini-pro", "custom"],
    defaultModel: "gemini-1.5-pro",
    requiresApiKey: true,
    apiKey: null,
    color: colors.warning,
  },
};

// Memory Buffer System - Simplified
class MemoryBuffer {
  constructor() {
    this.files = new Map(); // Store file contents
    this.actions = []; // Store recent actions
    this.conversations = []; // Store conversation history
  }

  storeFile(filePath, content) {
    this.files.set(filePath, {
      content,
      lastModified: new Date().toISOString(),
      size: content.length,
    });
    console.log(
      colors.success +
        "📄 " +
        path.basename(filePath) +
        " stored" +
        colors.reset
    );
  }

  getFile(filePath) {
    return this.files.get(filePath);
  }

  listFiles() {
    return Array.from(this.files.keys());
  }

  addAction(action, target, result) {
    this.actions.push({
      action,
      target,
      result,
      timestamp: new Date().toISOString(),
    });
    // Keep only last 50 actions
    if (this.actions.length > 50) {
      this.actions = this.actions.slice(-50);
    }
  }

  getContext() {
    const recentActions = this.actions.slice(-5);
    const availableFiles = Array.from(this.files.keys());

    return {
      recentActions,
      availableFiles,
      totalFiles: this.files.size,
      // Add more detailed file info for the AI
      fileDetails: Array.from(this.files.entries()).map(([filePath, info]) => ({
        path: filePath,
        name: path.basename(filePath),
        size: info.size,
        lastModified: info.lastModified,
      })),
    };
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
      colors.warning +
        "Warning: Could not load config: " +
        error.message +
        colors.reset
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
      colors.success + "Configuration saved successfully" + colors.reset
    );
  } catch (error) {
    console.log(
      colors.error + "Could not save config: " + error.message + colors.reset
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

// Special Tokens for Unvibe Commands
const UNVIBE_TOKENS = {
  READ: "<|unvibe_read|>",
  DELETE: "<|unvibe_delete|>",
  EDIT: "<|unvibe_edit|>",
  CREATE_FILE: "<|unvibe_create_file|>",
  CREATE_FOLDER: "<|unvibe_create_folder|>",
  RENAME: "<|unvibe_rename|>",
  TERMINAL: "<|unvibe_terminal|>",
  LIST: "<|unvibe_list|>",
  SEARCH: "<|unvibe_search|>",
  END: "<|unvibe_end|>",
  SEPARATOR: "<|parameter_separator|>",
};

// Parse special tokens from AI response
function parseUnvibeTokens(text) {
  const commands = [];

  // Only parse if we have potential complete tokens
  if (!text.includes("<|unvibe_") || !text.includes("<|/unvibe_")) {
    return commands;
  }

  // Look for complete token patterns: <|token|>content<|parameter_separator|>target<|/token|>
  const tokenPattern =
    /<\|unvibe_(\w+)\|>([\s\S]*?)<\|parameter_separator\|>([\s\S]*?)<\|\/unvibe_\1\|>/g;

  let match;
  while ((match = tokenPattern.exec(text)) !== null) {
    const action = match[1];
    const parameter = match[2].trim();
    const target = match[3].trim();

    commands.push({
      action,
      parameter,
      target,
      fullMatch: match[0],
    });
  }

  if (commands.length > 0) {
    console.log(
      colors.info +
        "Found " +
        commands.length +
        " complete token(s)" +
        colors.reset
    );
    // Debug: show what tokens were found
    commands.forEach((cmd, index) => {
      console.log(
        colors.dim +
          `Token ${index + 1}: ${cmd.action} -> ${cmd.target}` +
          colors.reset
      );
    });
  }

  return commands;
}

// Execute Unvibe commands
async function executeUnvibeCommand(command, memory) {
  const { action, parameter, target } = command;

  console.log(
    colors.info +
      "Executing: " +
      action.toUpperCase() +
      " " +
      (action === "terminal" ? parameter : target) +
      colors.reset
  );

  try {
    switch (action) {
      case "read":
        return await executeRead(target, memory);

      case "delete":
        return await executeDelete(target, memory);

      case "edit":
        return await executeEdit(target, parameter, memory);

      case "create_file":
        return await executeCreateFile(target, parameter, memory);

      case "create_folder":
        return await executeCreateFolder(target, memory);

      case "rename":
        return await executeRename(parameter, target, memory);

      case "terminal":
        // For terminal commands, parameter is the command, target is the description
        return await executeTerminal(parameter, memory);

      case "list":
        return await executeList(target, memory);

      case "search":
        return await executeSearch(parameter, target, memory);

      default:
        return { success: false, message: "Unknown action: " + action };
    }
  } catch (error) {
    console.log(
      colors.error +
        "Error executing " +
        action +
        ": " +
        error.message +
        colors.reset
    );
    return { success: false, message: error.message };
  }
}

// Command implementations
async function executeRead(filePath, memory) {
  try {
    // Try to resolve file path
    const resolvedPath = resolveFilePath(filePath);

    if (!fs.existsSync(resolvedPath)) {
      return { success: false, message: "File not found: " + filePath };
    }

    const content = fs.readFileSync(resolvedPath, "utf-8");
    memory.storeFile(resolvedPath, content);
    memory.addAction("read", filePath, { success: true });

    console.log(
      colors.success +
        "📄 " +
        path.basename(resolvedPath) +
        " read (" +
        content.length +
        " chars)" +
        colors.reset
    );
    return {
      success: true,
      message: "File read successfully",
      content,
      path: resolvedPath,
    };
  } catch (error) {
    return { success: false, message: error.message };
  }
}

async function executeDelete(filePath, memory) {
  try {
    const resolvedPath = resolveFilePath(filePath);

    if (!fs.existsSync(resolvedPath)) {
      return { success: false, message: "File not found: " + filePath };
    }

    const stats = fs.statSync(resolvedPath);
    if (stats.isDirectory()) {
      fs.rmSync(resolvedPath, { recursive: true, force: true });
    } else {
      fs.unlinkSync(resolvedPath);
    }

    memory.addAction("delete", filePath, { success: true });
    console.log(
      colors.success +
        "🗑️ " +
        path.basename(resolvedPath) +
        " deleted" +
        colors.reset
    );
    return { success: true, message: "Deleted successfully" };
  } catch (error) {
    return { success: false, message: error.message };
  }
}

async function executeEdit(filePath, newContent, memory) {
  try {
    const resolvedPath = resolveFilePath(filePath);

    // Create directories if they don't exist
    const dir = path.dirname(resolvedPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(resolvedPath, newContent, "utf-8");
    memory.storeFile(resolvedPath, newContent);
    memory.addAction("edit", filePath, { success: true });

    console.log(
      colors.success +
        "✏️ " +
        path.basename(resolvedPath) +
        " edited (" +
        newContent.length +
        " chars)" +
        colors.reset
    );
    return { success: true, message: "File edited successfully" };
  } catch (error) {
    return { success: false, message: error.message };
  }
}

async function executeCreateFile(filePath, content, memory) {
  try {
    const resolvedPath = resolveFilePath(filePath);

    // Create directories if they don't exist
    const dir = path.dirname(resolvedPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(resolvedPath, content, "utf-8");
    memory.storeFile(resolvedPath, content);
    memory.addAction("create_file", filePath, { success: true });

    console.log(
      colors.success +
        "📝 " +
        path.basename(resolvedPath) +
        " created (" +
        content.length +
        " chars)" +
        colors.reset
    );
    return { success: true, message: "File created successfully" };
  } catch (error) {
    return { success: false, message: error.message };
  }
}

async function executeCreateFolder(folderPath, memory) {
  try {
    const resolvedPath = resolveFilePath(folderPath);

    if (!fs.existsSync(resolvedPath)) {
      fs.mkdirSync(resolvedPath, { recursive: true });
    }

    memory.addAction("create_folder", folderPath, { success: true });
    console.log(
      colors.success +
        "📁 " +
        path.basename(resolvedPath) +
        " created" +
        colors.reset
    );
    return { success: true, message: "Folder created successfully" };
  } catch (error) {
    return { success: false, message: error.message };
  }
}

async function executeRename(oldPath, newPath, memory) {
  try {
    const resolvedOldPath = resolveFilePath(oldPath);
    const resolvedNewPath = resolveFilePath(newPath);

    if (!fs.existsSync(resolvedOldPath)) {
      return { success: false, message: "File not found: " + oldPath };
    }

    fs.renameSync(resolvedOldPath, resolvedNewPath);
    memory.addAction("rename", oldPath + " -> " + newPath, { success: true });

    console.log(
      colors.success +
        "🔄 " +
        path.basename(oldPath) +
        " → " +
        path.basename(newPath) +
        colors.reset
    );
    return { success: true, message: "Renamed successfully" };
  } catch (error) {
    return { success: false, message: error.message };
  }
}

async function executeTerminal(command, memory) {
  return new Promise((resolve) => {
    // Clean the command - remove any description prefixes that might have been parsed incorrectly
    let cleanCommand = command.replace(
      /^(Installing dependencies|Starting development server|Creating React app|Running command|Executing)\s*/,
      ""
    );

    // Additional cleaning for common issues
    cleanCommand = cleanCommand.replace(
      /^(Creating React app|Installing dependencies|Starting development server)\s*$/,
      ""
    );

    // If command looks like a description rather than actual command, try to infer the command
    if (cleanCommand === "Creating React app" || cleanCommand === "") {
      cleanCommand = "npx create-react-app calculator-app";
    }
    if (cleanCommand === "Installing dependencies") {
      cleanCommand = "cd calculator-app && npm install";
    }
    if (cleanCommand === "Starting development server") {
      cleanCommand = "cd calculator-app && npm start";
    }

    console.log(colors.info + "→ " + cleanCommand + colors.reset);

    const child = spawn(cleanCommand, [], {
      shell: true,
      stdio: ["inherit", "pipe", "pipe"],
      cwd: process.cwd(),
    });

    let output = "";
    let error = "";

    child.stdout.on("data", (data) => {
      const text = data.toString();
      output += text;
      // Show more useful output for common operations
      if (
        text.includes("error") ||
        text.includes("Error") ||
        text.includes("SUCCESS") ||
        text.includes("Done") ||
        text.includes("installed") ||
        text.includes("dependencies") ||
        text.includes("Local:") ||
        text.includes("http://") ||
        text.includes("Creating a new React app") ||
        text.includes("Installing packages") ||
        text.includes("Happy hacking!")
      ) {
        process.stdout.write(colors.dim + text.trim() + colors.reset + "\n");
      }
    });

    child.stderr.on("data", (data) => {
      const text = data.toString();
      error += text;
      // Show errors but keep them concise
      if (text.trim()) {
        process.stderr.write(
          colors.error + "⚠ " + text.trim() + colors.reset + "\n"
        );
      }
    });

    child.on("close", (code) => {
      memory.addAction("terminal", cleanCommand, {
        success: code === 0,
        output,
        error,
      });

      if (code === 0) {
        console.log(colors.success + "✓ Command completed" + colors.reset);
        resolve({
          success: true,
          message: "Command executed successfully",
          output,
        });
      } else {
        console.log(
          colors.error +
            "✗ Command failed (exit code " +
            code +
            ")" +
            colors.reset
        );
        resolve({
          success: false,
          message: "Command failed with code " + code,
          error,
        });
      }
    });
  });
}

async function executeList(target, memory) {
  try {
    const resolvedPath = target ? resolveFilePath(target) : process.cwd();

    if (!fs.existsSync(resolvedPath)) {
      return { success: false, message: "Path not found: " + target };
    }

    const stats = fs.statSync(resolvedPath);
    if (!stats.isDirectory()) {
      return { success: false, message: "Not a directory: " + target };
    }

    const entries = fs.readdirSync(resolvedPath, { withFileTypes: true });
    const files = entries
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name);
    const folders = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);

    memory.addAction("list", target || ".", { success: true });

    console.log(
      colors.success +
        "📁 " +
        path.basename(resolvedPath) +
        " (" +
        (files.length + folders.length) +
        " items)" +
        colors.reset
    );

    return {
      success: true,
      message: "Listed directory contents",
      files,
      folders,
      path: resolvedPath,
    };
  } catch (error) {
    return { success: false, message: error.message };
  }
}

async function executeSearch(query, target, memory) {
  try {
    const searchPath = target ? resolveFilePath(target) : process.cwd();
    const results = [];

    function searchInFile(filePath) {
      try {
        const content = fs.readFileSync(filePath, "utf-8");
        const lines = content.split("\n");
        const matches = [];

        lines.forEach((line, index) => {
          if (line.toLowerCase().includes(query.toLowerCase())) {
            matches.push({
              line: index + 1,
              content: line.trim(),
            });
          }
        });

        if (matches.length > 0) {
          results.push({
            file: filePath,
            matches,
          });
        }
      } catch (err) {
        // Skip files that can't be read
      }
    }

    function searchRecursive(dir) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.name.startsWith(".") || entry.name === "node_modules")
          continue;

        const fullPath = path.join(dir, entry.name);

        if (entry.isFile()) {
          searchInFile(fullPath);
        } else if (entry.isDirectory()) {
          searchRecursive(fullPath);
        }
      }
    }

    if (fs.statSync(searchPath).isFile()) {
      searchInFile(searchPath);
    } else {
      searchRecursive(searchPath);
    }

    memory.addAction("search", '"' + query + '" in ' + (target || "."), {
      success: true,
    });

    console.log(
      colors.success +
        "🔍 " +
        results.length +
        ' files contain "' +
        query +
        '"' +
        colors.reset
    );

    return {
      success: true,
      message: "Search completed",
      results,
      query,
    };
  } catch (error) {
    return { success: false, message: error.message };
  }
}

// Helper function to resolve file paths
function resolveFilePath(filePath) {
  if (path.isAbsolute(filePath)) {
    return filePath;
  }
  return path.resolve(process.cwd(), filePath);
}

// Helper function to detect project type
function detectProjectType(directory = process.cwd()) {
  try {
    const packageJsonPath = path.join(directory, "package.json");
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));

      // Check for React
      if (
        packageJson.dependencies?.react ||
        packageJson.devDependencies?.react
      ) {
        return "react";
      }

      // Check for Next.js
      if (packageJson.dependencies?.next || packageJson.devDependencies?.next) {
        return "nextjs";
      }

      // Check for Vue
      if (packageJson.dependencies?.vue || packageJson.devDependencies?.vue) {
        return "vue";
      }

      // Check for Angular
      if (
        packageJson.dependencies?.["@angular/core"] ||
        packageJson.devDependencies?.["@angular/core"]
      ) {
        return "angular";
      }

      // Check for Express/Node.js server
      if (
        packageJson.dependencies?.express ||
        packageJson.dependencies?.fastify
      ) {
        return "node-server";
      }

      return "node";
    }

    // Check for other project indicators
    if (
      fs.existsSync(path.join(directory, "requirements.txt")) ||
      fs.existsSync(path.join(directory, "pyproject.toml"))
    ) {
      return "python";
    }

    if (fs.existsSync(path.join(directory, "Cargo.toml"))) {
      return "rust";
    }

    if (fs.existsSync(path.join(directory, "go.mod"))) {
      return "go";
    }

    return "generic";
  } catch (error) {
    return "generic";
  }
}

// Helper function to check if dependencies need to be installed
function needsDependencyInstall(directory = process.cwd()) {
  const packageJsonPath = path.join(directory, "package.json");
  const nodeModulesPath = path.join(directory, "node_modules");

  if (fs.existsSync(packageJsonPath) && !fs.existsSync(nodeModulesPath)) {
    return true;
  }

  return false;
}

// Helper function to get smart install command based on project type
function getSmartInstallCommand(projectType, directory = process.cwd()) {
  const hasYarnLock = fs.existsSync(path.join(directory, "yarn.lock"));
  const hasPnpmLock = fs.existsSync(path.join(directory, "pnpm-lock.yaml"));

  let packageManager = "npm";
  if (hasPnpmLock) packageManager = "pnpm";
  else if (hasYarnLock) packageManager = "yarn";

  switch (projectType) {
    case "react":
    case "nextjs":
    case "vue":
    case "angular":
    case "node":
      return `${packageManager} install`;
    case "python":
      return "pip install -r requirements.txt";
    case "rust":
      return "cargo build";
    case "go":
      return "go mod download";
    default:
      return null;
  }
}

// Helper function to check and execute tokens from buffer
async function checkAndExecuteTokens(
  buffer,
  executedCommands,
  memory,
  onCommand
) {
  const commands = parseUnvibeTokens(buffer);
  let updatedBuffer = buffer;
  let executionContext = "";

  for (const command of commands) {
    const commandKey = command.fullMatch;
    if (!executedCommands.has(commandKey)) {
      executedCommands.add(commandKey);
      const result = await executeUnvibeCommand(command, memory);

      // Create immediate context feedback for the AI
      const contextUpdate = `[EXECUTION_RESULT: ${command.action.toUpperCase()} ${
        command.target
      } - ${result.success ? "SUCCESS" : "FAILED: " + result.message}]`;
      executionContext += contextUpdate + "\n";

      if (onCommand) onCommand(command, result, contextUpdate);
      // Remove executed command from buffer to avoid re-execution
      updatedBuffer = updatedBuffer.replace(command.fullMatch, contextUpdate);
    }
  }

  return { buffer: updatedBuffer, context: executionContext };
}

// Streaming AI Response Handler
async function streamAIResponse(prompt, provider, memory, onToken, onCommand) {
  const selectedModel =
    PROVIDERS[provider].selectedModel || PROVIDERS[provider].defaultModel;

  try {
    let buffer = "";
    const executedCommands = new Set();

    if (provider === "ollama") {
      const response = await axios({
        method: "post",
        url: PROVIDERS.ollama.streamUrl,
        data: {
          model: selectedModel,
          messages: [{ role: "user", content: prompt }],
          stream: true,
          options: {
            temperature: 0.3,
            top_p: 0.8,
          },
        },
        responseType: "stream",
      });

      response.data.on("data", async (chunk) => {
        const lines = chunk
          .toString()
          .split("\n")
          .filter((line) => line.trim());

        for (const line of lines) {
          try {
            const data = JSON.parse(line);
            if (data.message && data.message.content) {
              const content = data.message.content;
              buffer += content;

              // Call onToken callback
              if (onToken) onToken(content);

              // Check for unvibe tokens periodically (every few tokens or when closing tag detected)
              if (buffer.includes("<|/unvibe_")) {
                const result = await checkAndExecuteTokens(
                  buffer,
                  executedCommands,
                  memory,
                  onCommand
                );
                buffer = result.buffer;
                // Inject execution context back into the stream so AI knows what happened
                if (result.context && onToken) {
                  onToken(result.context);
                }
              }
            }
          } catch (e) {
            // Skip invalid JSON lines
          }
        }
      });

      return new Promise((resolve) => {
        response.data.on("end", () => {
          resolve(buffer);
        });
      });
    } else if (provider === "openai") {
      const response = await axios({
        method: "post",
        url: PROVIDERS.openai.streamUrl,
        headers: {
          Authorization: "Bearer " + PROVIDERS.openai.apiKey,
          "Content-Type": "application/json",
        },
        data: {
          model: selectedModel,
          messages: [{ role: "user", content: prompt }],
          stream: true,
          temperature: 0.3,
        },
        responseType: "stream",
      });

      response.data.on("data", async (chunk) => {
        const lines = chunk
          .toString()
          .split("\n")
          .filter((line) => line.trim());

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6);
            if (data === "[DONE]") return;

            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices?.[0]?.delta?.content;
              if (content) {
                buffer += content;

                // Call onToken callback
                if (onToken) onToken(content);

                // Check for unvibe tokens periodically (when closing tag detected)
                if (buffer.includes("<|/unvibe_")) {
                  const result = await checkAndExecuteTokens(
                    buffer,
                    executedCommands,
                    memory,
                    onCommand
                  );
                  buffer = result.buffer;
                  // Inject execution context back into the stream
                  if (result.context && onToken) {
                    onToken(result.context);
                  }
                }
              }
            } catch (e) {
              // Skip invalid JSON
            }
          }
        }
      });

      return new Promise((resolve) => {
        response.data.on("end", () => {
          resolve(buffer);
        });
      });
    } else if (provider === "mistral") {
      const response = await axios({
        method: "post",
        url: PROVIDERS.mistral.streamUrl,
        headers: {
          Authorization: "Bearer " + PROVIDERS.mistral.apiKey,
          "Content-Type": "application/json",
        },
        data: {
          model: selectedModel,
          messages: [{ role: "user", content: prompt }],
          stream: true,
          temperature: 0.3,
        },
        responseType: "stream",
      });

      response.data.on("data", async (chunk) => {
        const lines = chunk
          .toString()
          .split("\n")
          .filter((line) => line.trim());

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6);
            if (data === "[DONE]") return;

            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices?.[0]?.delta?.content;
              if (content) {
                buffer += content;

                // Call onToken callback
                if (onToken) onToken(content);

                // Check for unvibe tokens periodically (when closing tag detected)
                if (buffer.includes("<|/unvibe_")) {
                  const result = await checkAndExecuteTokens(
                    buffer,
                    executedCommands,
                    memory,
                    onCommand
                  );
                  buffer = result.buffer;
                  // Inject execution context back into the stream
                  if (result.context && onToken) {
                    onToken(result.context);
                  }
                }
              }
            } catch (e) {
              // Skip invalid JSON
            }
          }
        }
      });

      return new Promise((resolve) => {
        response.data.on("end", () => {
          resolve(buffer);
        });
      });
    } else if (provider === "google") {
      // Google Gemini API
      const response = await axios.post(
        `${PROVIDERS.google.apiUrl}/${selectedModel}:generateContent?key=${PROVIDERS.google.apiKey}`,
        {
          contents: [
            {
              parts: [{ text: prompt }],
            },
          ],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 4096,
          },
        },
        {
          headers: {
            "Content-Type": "application/json",
          },
        }
      );

      const content =
        response.data.candidates?.[0]?.content?.parts?.[0]?.text || "";
      buffer = content;

      // Process all content at once
      if (onToken) onToken(content);

      const result = await checkAndExecuteTokens(
        buffer,
        executedCommands,
        memory,
        onCommand
      );
      buffer = result.buffer;

      // Send execution context back as additional content
      if (result.context && onToken) {
        onToken(result.context);
      }

      return content;
    } else if (provider === "claude") {
      // Claude doesn't support streaming in the same way, so we'll use regular API
      const response = await axios.post(
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

      const content = response.data.content?.[0]?.text || "";
      buffer = content;

      // Process all content at once
      if (onToken) onToken(content);

      const result = await checkAndExecuteTokens(
        buffer,
        executedCommands,
        memory,
        onCommand
      );
      buffer = result.buffer;

      // Send execution context back as additional content
      if (result.context && onToken) {
        onToken(result.context);
      }

      return content;
    }
  } catch (error) {
    console.log(
      colors.error + "Streaming error: " + error.message + colors.reset
    );
    throw error;
  }
}

// Main AI Assistant Function
async function runUnvibeAgent(userInput, provider, memory) {
  const context = memory.getContext();
  const currentDir = process.cwd();
  const projectType = detectProjectType(currentDir);
  const needsInstall = needsDependencyInstall(currentDir);
  const installCommand = getSmartInstallCommand(projectType, currentDir);

  const systemPrompt =
    "You are Unvibe, an advanced AI file assistant. You help users manage files and execute tasks using special tokens.\n\n" +
    "AVAILABLE COMMANDS with special tokens:\n" +
    "1. <|unvibe_read|>description<|parameter_separator|>file_path<|/unvibe_read|> - Read file contents\n" +
    "2. <|unvibe_create_file|>file_content<|parameter_separator|>file_path<|/unvibe_create_file|> - Create new file\n" +
    "3. <|unvibe_create_folder|>description<|parameter_separator|>folder_path<|/unvibe_create_folder|> - Create folder\n" +
    "4. <|unvibe_edit|>new_file_content<|parameter_separator|>file_path<|/unvibe_edit|> - Edit existing file\n" +
    "5. <|unvibe_delete|>description<|parameter_separator|>file_path<|/unvibe_delete|> - Delete file/folder\n" +
    "6. <|unvibe_rename|>old_path<|parameter_separator|>new_path<|/unvibe_rename|> - Rename file/folder\n" +
    "7. <|unvibe_terminal|>actual_command<|parameter_separator|>description<|/unvibe_terminal|> - Execute terminal command\n" +
    "8. <|unvibe_list|>description<|parameter_separator|>directory_path<|/unvibe_list|> - List directory contents\n" +
    "9. <|unvibe_search|>search_query<|parameter_separator|>search_path<|/unvibe_search|> - Search for text in files\n\n" +
    "TERMINAL COMMAND EXAMPLES (CORRECT FORMAT):\n" +
    "- <|unvibe_terminal|>npx create-react-app calculator-app<|parameter_separator|>Creating React app<|/unvibe_terminal|>\n" +
    "- <|unvibe_terminal|>cd calculator-app && npm install<|parameter_separator|>Installing dependencies<|/unvibe_terminal|>\n" +
    "- <|unvibe_terminal|>cd calculator-app && npm start<|parameter_separator|>Starting dev server<|/unvibe_terminal|>\n" +
    "- <|unvibe_terminal|>npm install react-router-dom<|parameter_separator|>Installing routing package<|/unvibe_terminal|>\n\n" +
    "CURRENT CONTEXT:\n" +
    "- Operating System: " +
    os.platform() +
    " (" +
    os.type() +
    " " +
    os.release() +
    ")\n" +
    "- Shell/Terminal: " +
    (process.env.SHELL || process.env.ComSpec || "cmd.exe") +
    "\n" +
    "- Architecture: " +
    os.arch() +
    "\n" +
    "- Project Type: " +
    projectType +
    (needsInstall ? " (NEEDS DEPENDENCY INSTALL)" : "") +
    "\n" +
    "- Recommended Install Command: " +
    (installCommand || "none") +
    "\n" +
    "- Available files in memory: " +
    (context.availableFiles.join(", ") || "none") +
    "\n" +
    "- File details: " +
    (context.fileDetails
      ? context.fileDetails.map((f) => `${f.name} (${f.path})`).join(", ")
      : "none") +
    "\n" +
    "- Recent actions: " +
    (context.recentActions.map((a) => a.action + " " + a.target).join(", ") ||
      "none") +
    "\n" +
    "- Total files in memory: " +
    context.totalFiles +
    "\n" +
    "- Working directory: " +
    process.cwd() +
    "\n\n" +
    "CRITICAL EXECUTION RULES:\n" +
    "1. ALWAYS use the exact token format shown above with closing tags like <|/unvibe_action|>\n" +
    "2. You MUST include the closing tag for commands to be executed\n" +
    "3. Use tokens to perform file operations during conversation - EXECUTE IMMEDIATELY\n" +
    "4. Do NOT ask for permission - just execute the commands as you explain them\n" +
    "5. Chain multiple commands when needed to complete complex tasks\n" +
    "6. ALWAYS check what files exist first using <|unvibe_list|> before trying to delete/edit them\n" +
    "7. Use relative paths from the working directory or absolute paths\n" +
    "8. EXAMPLE: <|unvibe_create_folder|>Creating test folder<|parameter_separator|>test<|/unvibe_create_folder|>\n" +
    "9. Execute ALL required commands in sequence to complete the user's request fully\n" +
    "10. If unsure about file locations, use <|unvibe_list|> to check directory contents first\n" +
    "11. Use OS-appropriate commands: Windows (cmd/powershell), Linux/Mac (bash/zsh/fish)\n" +
    "12. For npm/node commands, ensure you're in the correct directory using 'cd \"path\" && command'\n\n" +
    "COMMAND-FIRST APPROACH - ALWAYS USE TERMINAL COMMANDS FOR:\n" +
    "- Creating React apps: <|unvibe_terminal|>npx create-react-app calculator-app<|parameter_separator|>Creating React calculator app<|/unvibe_terminal|>\n" +
    "- Installing packages: <|unvibe_terminal|>npm install package-name<|parameter_separator|>Installing package<|/unvibe_terminal|>\n" +
    "- Starting dev servers: <|unvibe_terminal|>cd app-folder && npm start<|parameter_separator|>Starting development server<|/unvibe_terminal|>\n" +
    "- Building projects: <|unvibe_terminal|>cd app-folder && npm run build<|parameter_separator|>Building project<|/unvibe_terminal|>\n" +
    "- Git operations: <|unvibe_terminal|>git init<|parameter_separator|>Initializing git repo<|/unvibe_terminal|>\n" +
    "- Creating Next.js apps: <|unvibe_terminal|>npx create-next-app@latest app-name<|parameter_separator|>Creating Next.js app<|/unvibe_terminal|>\n" +
    "- Creating Vue apps: <|unvibe_terminal|>npm create vue@latest app-name<|parameter_separator|>Creating Vue app<|/unvibe_terminal|>\n" +
    "- Python virtual environments: <|unvibe_terminal|>python -m venv venv<|parameter_separator|>Creating virtual environment<|/unvibe_terminal|>\n\n" +
    "13. SMART PROJECT HANDLING:\n" +
    "    - For React/Next.js/Vue/Angular projects: ALWAYS run dependency install if node_modules missing\n" +
    "    - Use the correct package manager (npm/yarn/pnpm) based on lock files\n" +
    "    - After creating React components, suggest running the dev server\n" +
    "    - When creating new React projects, auto-install dependencies\n" +
    "    - For React apps, use proper JSX syntax and modern React patterns\n" +
    "    - When editing package.json, run install command after changes\n" +
    "    - When user says 'make a react app', immediately run: npx create-react-app [app-name]\n" +
    "    - When user says 'install X', immediately run: npm install X\n" +
    "    - When user says 'start the server', immediately run: cd [app-folder] && npm start\n" +
    "    - ALWAYS use specific app names like 'calculator-app' for clarity\n" +
    "    - ALWAYS navigate to the app directory before running npm commands\n" +
    (needsInstall
      ? "14. CRITICAL: This project needs dependency installation! Run: " +
        installCommand +
        "\n"
      : "") +
    "\n" +
    "TERMINAL FORMAT REMINDER:\n" +
    "- FIRST parameter: The actual command to execute (like 'npx create-react-app calculator-app')\n" +
    "- SECOND parameter: Human-readable description (like 'Creating React calculator app')\n" +
    "- Example: <|unvibe_terminal|>npx create-react-app calculator-app<|parameter_separator|>Creating React calculator app<|/unvibe_terminal|>\n" +
    "- WRONG: <|unvibe_terminal|>Creating React app<|parameter_separator|>npx create-react-app calculator-app<|/unvibe_terminal|>\n\n" +
    "USER REQUEST: " +
    userInput +
    "\n\n" +
    "Please analyze the request and execute ALL necessary file operations using the special tokens. Be COMMAND-FIRST - use terminal commands extensively. Complete the entire task in one response. Talk to the user naturally while performing ALL required actions immediately.";

  console.log(
    "\n" + colors.primary + "Unvibe Agent Processing..." + colors.reset
  );
  console.log(
    colors.dim +
      "Project: " +
      projectType +
      (needsInstall ? " (needs install)" : "") +
      colors.reset +
      "\n"
  );

  let aiResponse = "";
  let executedCommands = 0;

  try {
    const response = await streamAIResponse(
      systemPrompt,
      provider,
      memory,
      (token) => {
        // Real-time token display
        process.stdout.write(token);
        aiResponse += token;
      },
      (command, result) => {
        // Real-time command execution feedback
        executedCommands++;
        if (result.success) {
          console.log(
            "\n" +
              colors.success +
              "✓ Command " +
              executedCommands +
              " completed" +
              colors.reset +
              "\n"
          );
        } else {
          console.log(
            "\n" +
              colors.error +
              "✗ Command " +
              executedCommands +
              " failed: " +
              result.message +
              colors.reset +
              "\n"
          );
        }
      }
    );

    // Store conversation in memory
    memory.conversations.push({
      user: userInput,
      assistant: aiResponse,
      timestamp: new Date().toISOString(),
      commandsExecuted: executedCommands,
      projectType: projectType,
    });

    console.log("\n\n" + colors.info + "Session Summary:" + colors.reset);
    console.log(
      colors.dim + "Commands executed: " + executedCommands + colors.reset
    );
    console.log(
      colors.dim + "Files in memory: " + memory.files.size + colors.reset
    );
    console.log(
      colors.dim +
        "Response length: " +
        aiResponse.length +
        " characters" +
        colors.reset
    );
  } catch (error) {
    console.log("\n" + colors.error + "Error: " + error.message + colors.reset);
  }
}

// Main function
async function main() {
  console.log(
    colors.bold +
      colors.primary +
      "Welcome to Unvibe - Advanced AI File Assistant" +
      colors.reset
  );
  console.log(
    colors.dim +
      "Real-time streaming with special token execution" +
      colors.reset +
      "\n"
  );

  // Load configuration
  loadConfig();

  const memory = new MemoryBuffer();

  // Provider selection
  const { provider } = await inquirer.prompt([
    {
      type: "list",
      name: "provider",
      message: "Choose your AI provider:",
      choices: [
        { name: "Ollama (Local - No API Key)", value: "ollama" },
        { name: "Mistral", value: "mistral" },
        { name: "OpenAI (ChatGPT)", value: "openai" },
        { name: "Claude (Anthropic)", value: "claude" },
        { name: "Google Gemini", value: "google" },
      ],
    },
  ]);

  // API key configuration for providers that need it
  if (PROVIDERS[provider].requiresApiKey && !PROVIDERS[provider].apiKey) {
    const { apiKey } = await inquirer.prompt([
      {
        type: "password",
        name: "apiKey",
        message: "Enter your " + PROVIDERS[provider].name + " API key:",
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
    console.log(
      colors.success +
        "API key configured for " +
        PROVIDERS[provider].name +
        colors.reset
    );
  }

  // Model selection
  const modelChoices = PROVIDERS[provider].models.map((model) => ({
    name:
      model === "custom"
        ? colors.warning + "Custom Model" + colors.reset
        : PROVIDERS[provider].color + model + colors.reset,
    value: model,
  }));

  const { selectedModel } = await inquirer.prompt([
    {
      type: "list",
      name: "selectedModel",
      message:
        colors.highlight +
        "Choose model for " +
        PROVIDERS[provider].name +
        ":" +
        colors.reset,
      choices: modelChoices,
      default:
        PROVIDERS[provider].selectedModel || PROVIDERS[provider].defaultModel,
    },
  ]);

  // Handle custom model
  if (selectedModel === "custom") {
    const { customModel } = await inquirer.prompt([
      {
        type: "input",
        name: "customModel",
        message: colors.primary + "Enter custom model name:" + colors.reset,
        validate: (input) => (input.trim() ? true : "Model name is required"),
      },
    ]);
    PROVIDERS[provider].selectedModel = customModel.trim();
  } else {
    PROVIDERS[provider].selectedModel = selectedModel;
  }

  // Save configuration
  updateProviderConfig(
    provider,
    PROVIDERS[provider].apiKey,
    PROVIDERS[provider].selectedModel
  );

  console.log(
    colors.success +
      "Using " +
      PROVIDERS[provider].name +
      " with " +
      PROVIDERS[provider].selectedModel +
      colors.reset +
      "\n"
  );

  // Main interaction loop
  while (true) {
    const { input } = await inquirer.prompt([
      {
        type: "input",
        name: "input",
        message:
          colors.primary +
          "What would you like me to help you with?" +
          colors.reset +
          " (type 'exit' to quit, 'memory' for memory info):",
      },
    ]);

    if (input.toLowerCase() === "exit") {
      console.log(
        colors.success + "Thank you for using Unvibe! Goodbye!" + colors.reset
      );
      break;
    }

    if (input.toLowerCase() === "memory") {
      const context = memory.getContext();
      console.log("\n" + colors.info + "Memory Status:" + colors.reset);
      console.log(
        colors.dim + "Files stored: " + memory.files.size + colors.reset
      );
      console.log(
        colors.dim +
          "Recent actions: " +
          context.recentActions.length +
          colors.reset
      );
      console.log(
        colors.dim +
          "Conversations: " +
          memory.conversations.length +
          colors.reset
      );
      if (memory.files.size > 0) {
        console.log(
          colors.dim +
            "Available files: " +
            Array.from(memory.files.keys())
              .map((f) => path.basename(f))
              .join(", ") +
            colors.reset
        );
      }
      continue;
    }

    console.log("\n" + colors.info + "=".repeat(60) + colors.reset);
    await runUnvibeAgent(input, provider, memory);
    console.log(colors.info + "=".repeat(60) + colors.reset + "\n");
  }
}

// Start the application
main().catch(console.error);
