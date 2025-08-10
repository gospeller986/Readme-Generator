const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());


async function generateReadmeWithLLM(repoData) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('Gemini API key not set');
    const prompt = `
    You are an expert technical writer and open-source maintainer. Your task is to create a complete, professional, and user-friendly README.md file for the given GitHub repository using the provided repository details.

Requirements for the README.md:

Title & Project Description

Use the repository name as the title.

Write a clear and engaging description of what the project does, who it’s for, and why it’s useful.

Table of Contents (for easy navigation).

Features

List key features and benefits of the project.

Installation Instructions

Step-by-step guide to clone and set up the project locally.

Include prerequisites (Node.js, Python, dependencies, etc.).

Usage Examples

Show how to run or use the project (commands, screenshots, or code snippets).

Technologies Used

Mention frameworks, libraries, and tools used in the project.

Contributing Guidelines

Explain how others can contribute (forking, creating PRs, reporting issues).

License Information

State the license type and link to the LICENSE file if available.

Additional Information (optional)

Roadmap, acknowledgements, related projects, badges, or links to documentation.

Repository details to use:

Name: ${repoData.name}

Description: ${repoData.description}

Topics: ${repoData.topics?.join(', ')}

URL: ${repoData.html_url}

Output Format:
Return only the final README.md in valid Markdown syntax, ready to be saved as a file.
    `

    // List available models
    const modelsRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    if (!modelsRes.ok) {
        const errorText = await modelsRes.text();
        throw new Error('Gemini ListModels error: ' + errorText);
    }
    const modelsData = await modelsRes.json();
    // Prefer less powerful models for generateContent
    let modelName = null;
    let proModelName = null;
    if (Array.isArray(modelsData.models)) {
        for (const model of modelsData.models) {
            if (model.supportedGenerationMethods && model.supportedGenerationMethods.includes('generateContent')) {
                if (!/pro/i.test(model.name) && !modelName) {
                    modelName = model.name;
                }
                if (/pro/i.test(model.name) && !proModelName) {
                    proModelName = model.name;
                }
            }
        }
    }
    // Use non-pro model if available, else fallback to pro model
    const selectedModel = modelName || proModelName;
    if (!selectedModel) throw new Error('No Gemini model found that supports generateContent');

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/${selectedModel}:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }]
        }),
    });
    if (!response.ok) {
        const errorText = await response.text();
        console.error('Gemini API error:', errorText);
        throw new Error('Gemini API error: ' + errorText);
    }
    const data = await response.json();
    // Gemini's response format
    return data.candidates?.[0]?.content?.parts?.[0]?.text || 'No README generated.';
}

// Helper to fetch repo data and important files from GitHub
async function fetchRepoDataAndFiles(repoUrl) {
    // Extract owner/repo from URL
    const match = repoUrl.match(/github.com\/([^\/]+)\/([^\/]+)(?:$|\/)?/);
    if (!match) throw new Error('Invalid GitHub URL');
    const owner = match[1];
    const repo = match[2];
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}`;
    const headers = {};
    if (process.env.GITHUB_TOKEN) {
        headers['Authorization'] = `token ${process.env.GITHUB_TOKEN}`;
    }
    // Fetch repo metadata
    const res = await fetch(apiUrl, { headers });
    if (!res.ok) throw new Error('GitHub repo not found');
    const repoData = await res.json();

    // List of important files to try to fetch
    const importantFiles = [
        'package.json', 'index.js', 'index.ts', 'index.html', 'README.md', 'main.js', 'main.ts', 'app.js', 'server.js', 'src/index.js', 'src/index.ts', 'src/main.js', 'src/main.ts', 'pom.xml', 'build.gradle', 'setup.py', 'requirements.txt', 'Dockerfile', 'Makefile', 'LICENSE'
    ];
    const filesContent = {};
    for (const filePath of importantFiles) {
        let fileApiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`;
        const fileRes = await fetch(fileApiUrl, { headers });
        if (fileRes.ok) {
            const fileData = await fileRes.json();
            if (fileData && fileData.content) {
                // Decode base64 content
                const buff = Buffer.from(fileData.content, 'base64');
                filesContent[filePath] = buff.toString('utf-8');
            }
        }
    }
    return { repoData, filesContent };
}

// Main endpoint
app.post('/generate-readme', async (req, res) => {
    try {
        const { githubUrl } = req.body;
        if (!githubUrl) return res.status(400).json({ error: 'githubUrl required' });
        const { repoData, filesContent } = await fetchRepoDataAndFiles(githubUrl);
        const readme = await generateReadmeWithLLM(repoData, filesContent);
        res.json({ readme });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Update prompt in generateReadmeWithLLM to include file contents
async function generateReadmeWithLLM(repoData, filesContent) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('Gemini API key not set');
    let filesSection = '';
    if (filesContent && typeof filesContent === 'object') {
        for (const [file, content] of Object.entries(filesContent)) {
            filesSection += `\n\n---\nFile: ${file}\n\n${content}\n`;
        }
    }
    const prompt = `You are a highly refined README generator. Your task is to carefully analyze the provided GitHub repository data and the important project files below, and generate a professional, comprehensive, and well-structured README.md file. The README should include an engaging project overview, setup instructions, usage examples, features, technologies used, contribution guidelines, license information, and any other relevant details. Use clear Markdown formatting and ensure the content is helpful for both new users and contributors.\n\nRepository details:\n- Name: ${repoData.name}\n- Description: ${repoData.description}\n- Topics: ${repoData.topics?.join(', ')}\n- URL: ${repoData.html_url}\n${filesSection}\n\nGenerate the complete README.md content below.`;

    // List available models
    const modelsRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    if (!modelsRes.ok) {
        const errorText = await modelsRes.text();
        throw new Error('Gemini ListModels error: ' + errorText);
    }
    const modelsData = await modelsRes.json();
    // Prefer less powerful models for generateContent
    let modelName = null;
    let proModelName = null;
    if (Array.isArray(modelsData.models)) {
        for (const model of modelsData.models) {
            if (model.supportedGenerationMethods && model.supportedGenerationMethods.includes('generateContent')) {
                if (!/pro/i.test(model.name) && !modelName) {
                    modelName = model.name;
                }
                if (/pro/i.test(model.name) && !proModelName) {
                    proModelName = model.name;
                }
            }
        }
    }
    // Use non-pro model if available, else fallback to pro model
    const selectedModel = modelName || proModelName;
    if (!selectedModel) throw new Error('No Gemini model found that supports generateContent');

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/${selectedModel}:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }]
        }),
    });
    if (!response.ok) {
        const errorText = await response.text();
        console.error('Gemini API error:', errorText);
        throw new Error('Gemini API error: ' + errorText);
    }
    const data = await response.json();
    // Gemini's response format
    return data.candidates?.[0]?.content?.parts?.[0]?.text || 'No README generated.';
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
