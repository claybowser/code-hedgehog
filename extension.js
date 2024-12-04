// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = require('vscode');
const axios = require('axios');

let isExecuting = false; // Flag to prevent multiple executions

// Function to clean markdown code blocks from response
function cleanMarkdownFormatting(text) {
	// Remove code fence blocks and language indicators
	return text.replace(/^```[\s\S]*?\n/, '') // Remove opening fence with language
		.replace(/\n```$/, '')          // Remove closing fence
		.replace(/^```/, '')            // Remove simple opening fence
		.replace(/```$/, '')            // Remove simple closing fence
		.trim();                        // Clean up whitespace
}

// Function to show preview and get user confirmation
async function showPreviewAndConfirm(originalText, suggestedText) {
	const panel = vscode.window.createWebviewPanel(
		'codePreview',
		'Code Suggestion Preview',
		vscode.ViewColumn.Beside,
		{
			enableScripts: true
		}
	);

	// HTML content for the preview with vertical layout
	panel.webview.html = `
		<!DOCTYPE html>
		<html>
		<head>
			<style>
				body { 
					padding: 20px; 
					max-width: 800px; 
					margin: 0 auto;
				}
				.header {
					text-align: center;
					margin-bottom: 20px;
				}
				.header a {
					color: #0366d6;
					font-weight: bold;
					text-decoration: none;
					font-size: 1.2em;
				}
				.header a:hover {
					text-decoration: underline;
				}
				.container { 
					display: flex;
					flex-direction: column;
					gap: 20px;
				}
				.code-block {
					width: 100%;
					padding: 15px;
					background-color: var(--vscode-editor-background);
					border: 1px solid var(--vscode-panel-border);
					border-radius: 4px;
				}
				pre {
					margin: 0;
					white-space: pre-wrap;
					font-family: var(--vscode-editor-font-family);
					font-size: var(--vscode-editor-font-size);
				}
				.title {
					font-weight: bold;
					margin-bottom: 10px;
					color: var(--vscode-editor-foreground);
					padding-bottom: 5px;
					border-bottom: 1px solid var(--vscode-panel-border);
				}
				.buttons {
					margin-top: 20px;
					display: flex;
					justify-content: center;
					gap: 10px;
				}
				button {
					padding: 8px 16px;
					cursor: pointer;
					background-color: var(--vscode-button-background);
					color: var(--vscode-button-foreground);
					border: none;
					border-radius: 2px;
				}
				button:hover {
					background-color: var(--vscode-button-hoverBackground);
				}
			</style>
		</head>
		<body>
			<div class="container">
				<div class="code-block">
					<div class="title">Original Code:</div>
					<pre>${escapeHtml(originalText)}</pre>
				</div>
				<div class="code-block">
					<div class="title">Suggested Code:</div>
					<pre>${escapeHtml(suggestedText)}</pre>
				</div>
			</div>
			<div class="buttons">
				<button id="accept">Accept Changes</button>
				<button id="reject">Reject Changes</button>
			</div>
			<script>
				const vscode = acquireVsCodeApi();
				document.getElementById('accept').addEventListener('click', () => {
					vscode.postMessage({ command: 'accept' });
				});
				document.getElementById('reject').addEventListener('click', () => {
					vscode.postMessage({ command: 'reject' });
				});
			</script>
		</body>
		<div class="header">
				<h3>CODE-HEDGEHOG BY CLAY BOWSER</h3>
				<a href="https://github.com/claybowser" target="_blank">
					FOLLOW ME ON GITHUB @claybowser
				</a>
			</div>
		</html>
	`;

	// Handle messages from the webview
	return new Promise((resolve) => {
		panel.webview.onDidReceiveMessage(
			message => {
				switch (message.command) {
					case 'accept':
						panel.dispose();
						resolve(true);
						break;
					case 'reject':
						panel.dispose();
						resolve(false);
						break;
				}
			}
		);
	});
}

// Helper function to escape HTML
function escapeHtml(unsafe) {
	return unsafe
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#039;");
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
	console.log('Code Hedgehog is now active!');

	// Register a command that triggers code suggestions manually
	const disposable = vscode.commands.registerCommand('code-hedgehog.getCodeSuggestion', async () => {
		// Prevent multiple executions
		if (isExecuting) {
			return;
		}

		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			vscode.window.showErrorMessage('No active editor found');
			return;
		}

		try {
			isExecuting = true;
			const document = editor.document;
			const selection = editor.selection;
			
			// Get the selected text or the current line if no selection
			let selectedText;
			let range;
			
			if (selection.isEmpty) {
				// If no text is selected, get the current line
				const line = document.lineAt(selection.active.line);
				selectedText = line.text;
				range = line.range;
			} else {
				// Get the selected text and its range
				selectedText = document.getText(selection);
				range = selection;
			}

			// Show progress indicator while waiting for response
			const response = await vscode.window.withProgress({
				location: vscode.ProgressLocation.Notification,
				title: "Getting code suggestion...",
				cancellable: false
			}, async (progress) => {
				progress.report({ increment: 0 });
				
				const response = await axios.post('http://localhost:11434/api/generate', {
					model: 'codegemma',
					prompt: 'You are a code completion tool. Respond with ONLY raw code - no markdown formatting, no code fence blocks (\\`\\`\\`), no language indicators. Replace or complete this code:\n\n' + selectedText + '\n\nProvide only raw code without any formatting:',
					stream: false
				});
				
				progress.report({ increment: 100 });
				return response;
			});

			if (response.data && response.data.response) {
				const cleanedResponse = cleanMarkdownFormatting(response.data.response);
				
				// Show preview and get confirmation
				const shouldApply = await showPreviewAndConfirm(selectedText, cleanedResponse);
				
				if (shouldApply) {
					await editor.edit(editBuilder => {
						editBuilder.replace(range, cleanedResponse);
					});
					vscode.window.showInformationMessage('Code suggestion applied!');
				} else {
					vscode.window.showInformationMessage('Code suggestion rejected');
				}
			} else {
				vscode.window.showErrorMessage('No response from server');
			}
		} catch (error) {
			console.error('Error:', error);
			vscode.window.showErrorMessage('Failed to get code suggestion');
		} finally {
			isExecuting = false;  // Reset the flag when done
		}
	});

	// Remove the provider registration and only push the command
	context.subscriptions.push(disposable);
}

// This method is called when your extension is deactivated
function deactivate() {}

module.exports = {
	activate,
	deactivate
}
