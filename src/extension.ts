// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as path from 'path';
import * as vscode from 'vscode';
// 如果你用 Node 18+，可以不用引入 node-fetch
// import fetch from 'node-fetch'; // Use dynamic import below instead

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "filgpt" is now active!');

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	const helloDisposable = vscode.commands.registerCommand('filgpt.helloWorld', () => {
		// The code you place here will be executed every time your command is executed
		// Display a message box to the user
		vscode.window.showInformationMessage('Hello World from FILGPT!');
	});
	context.subscriptions.push(helloDisposable);

	const chatDisposable = vscode.commands.registerCommand('filgpt.openChat', () => {
		const editor = vscode.window.activeTextEditor;
		let cachedCode = editor ? editor.document.getText() : '';

		const panel = vscode.window.createWebviewPanel(
			'filgptChat',
			'SIG plugin',
			vscode.ViewColumn.Beside,
			{
				enableScripts: true,
				retainContextWhenHidden: true
			}
		);

		panel.webview.html = getChatWebviewContent(context, panel.webview);

		// 监听编辑器切换和选区变化，主动发送当前文件名
		const updateContextFilename = () => {
			const editor = vscode.window.activeTextEditor;
			const filename = editor ? path.basename(editor.document.fileName) : '';
			panel.webview.postMessage({ type: 'contextFilename', value: filename });
		};
		const editorChangeDisposable = vscode.window.onDidChangeActiveTextEditor(updateContextFilename);
		const selectionChangeDisposable = vscode.window.onDidChangeTextEditorSelection(updateContextFilename);
		context.subscriptions.push(editorChangeDisposable, selectionChangeDisposable);

		// 初始化时也发送一次
		updateContextFilename();

		// 监听选区变化
		const selectionDisposable = vscode.window.onDidChangeTextEditorSelection(event => {
			const code = event.textEditor.document.getText();
			panel.webview.postMessage({ type: 'code', value: code });
		});
		context.subscriptions.push(selectionDisposable);

		panel.webview.onDidReceiveMessage(async message => {
			if (message.type === 'ready') {
				panel.webview.postMessage({ type: 'code', value: cachedCode });
			}
			if (message.type === 'userInput') {
				const prompt = message.value;
				const apiKey = '';
				const url = 'https://api.deepseek.com/chat/completions';
				const messages = message.messages || [
					{ role: "system", content: "You are a helpful assistant." },
					{ role: "user", content: prompt }
				];
				const body = {
					model: "deepseek-chat",
					messages,
					stream: true // 开启流式
				};
				try {
					const res = await fetch(url, {
						method: 'POST',
						headers: {
							'Content-Type': 'application/json',
							'Authorization': `Bearer ${apiKey}`
						},
						body: JSON.stringify(body)
					});
					if (!res.body) throw new Error('No response body');
					const reader = res.body.getReader();
					const decoder = new TextDecoder('utf-8');
					let buffer = '';
					let done = false;
					while (!done) {
						const { value, done: doneReading } = await reader.read();
						done = doneReading;
						if (value) {
							buffer += decoder.decode(value, { stream: true });
							// DeepSeek 返回格式为多行 data: ...\n
							const lines = buffer.split('\n');
							buffer = lines.pop() || '';
							for (const line of lines) {
								const trimmed = line.trim();
								if (trimmed.startsWith('data:')) {
									const jsonStr = trimmed.replace(/^data:\s*/, '');
									if (jsonStr === '[DONE]') {
										panel.webview.postMessage({ type: 'apiStreamEnd' });
										return;
									}
									try {
										const data = JSON.parse(jsonStr);
										const delta = data.choices?.[0]?.delta?.content;
										if (delta) {
											panel.webview.postMessage({ type: 'apiStream', value: delta });
										}
									} catch (e) {
										// 忽略解析失败
									}
								}
							}
						}
					}
					panel.webview.postMessage({ type: 'apiStreamEnd' });
				} catch (err) {
					panel.webview.postMessage({ type: 'apiResult', value: 'DeepSeek接口请求失败: ' + err });
				}
			}
			if (message.type === 'analyzeCode') {
				// 用 message.code 替代 cachedCode
				const codeToAnalyze = message.code || '';
				if (!codeToAnalyze) {
					panel.webview.postMessage({ type: 'apiResult', value: '未检测到代码内容' });
					return;
				}
				const apiKey = '';
				const url = 'https://api.deepseek.com/chat/completions';
				const body = {
					model: "deepseek-chat",
					messages: [
						{ role: "system", content: "你是一个专业的代码审查助手，请分析用户提供的代码并给出修改建议。" },
						{ role: "user", content: `请帮我分析以下代码并给出修改建议：\n\n${codeToAnalyze}` }
					],
					stream: false
				};
				try {
					const res = await fetch(url, {
						method: 'POST',
						headers: {
							'Content-Type': 'application/json',
							'Authorization': `Bearer ${apiKey}`
						},
						body: JSON.stringify(body)
					});
					const data = await res.json() as any;
					const answer = data.choices?.[0]?.message?.content || '未获取到分析建议';
					panel.webview.postMessage({ type: 'apiResult', value: answer });
				} catch (err) {
					panel.webview.postMessage({ type: 'apiResult', value: 'DeepSeek接口请求失败: ' + err });
				}
			}
			if (message.type === 'analyzeWorkspace') {
				const files = await vscode.workspace.findFiles('**/*.{js,ts,py,java,cpp,cs,go,rb}', '**/node_modules/**');
				let allCode = '';
				for (const file of files) {
					try {
						const doc = await vscode.workspace.openTextDocument(file);
						allCode += `\n\n// 文件: ${path.basename(file.fsPath)}\n${doc.getText()}`;
					} catch (e) {}
				}
				if (!allCode) {
					panel.webview.postMessage({ type: 'apiResult', value: '未找到可分析的代码文件' });
					return;
				}
				const apiKey = '';
				const url = 'https://api.deepseek.com/chat/completions';
				const body = {
					model: "deepseek-chat",
					messages: [
						{ role: "system", content: "你是一个专业的代码审查助手，请分析整个项目的代码并给出修改建议。" },
						{ role: "user", content: `请分析以下项目代码并给出修改建议：\n\n${allCode}` }
					],
					stream: false
				};
				try {
					const res = await fetch(url, {
						method: 'POST',
						headers: {
							'Content-Type': 'application/json',
							'Authorization': `Bearer ${apiKey}`
						},
						body: JSON.stringify(body)
					});
					const data = await res.json() as any;
					const answer = data.choices?.[0]?.message?.content || '未获取到分析建议';
					panel.webview.postMessage({ type: 'apiResult', value: answer });
				} catch (err) {
					panel.webview.postMessage({ type: 'apiResult', value: 'DeepSeek接口请求失败: ' + err });
				}
			}
			if (message.type === 'addContext') {
				const editor = vscode.window.activeTextEditor;
				const filename = editor ? path.basename(editor.document.fileName) : '';
				panel.webview.postMessage({ type: 'contextFilename', value: filename });
			}
			if (message.type === 'stopGenerate') {
				// 如果有正在进行的 API 请求，可以在这里中断（如用 AbortController）
				// 并通知前端
				panel.webview.postMessage({ type: 'stopGenerateAck' });
			}
			if (message.type === 'applyCode') {
				const editor = vscode.window.activeTextEditor;
				if (editor) {
					editor.edit(editBuilder => {
						// 你可以选择插入到光标处，也可以覆盖选中区域
						editBuilder.insert(editor.selection.active, message.value);
					});
					vscode.window.showInformationMessage('代码已插入到当前编辑器');
				} else {
					vscode.window.showWarningMessage('未找到活动编辑器，无法插入代码');
				}
			}
			if (message.type === 'focusEditor') {
				vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
			}
		});
	});
	context.subscriptions.push(chatDisposable);
}

function getChatWebviewContent(context: vscode.ExtensionContext, webview: vscode.Webview): string {
    const cssUri = webview.asWebviewUri(
        vscode.Uri.file(path.join(context.extensionPath, 'src', 'chat.css'))
    );
    const jsUri = webview.asWebviewUri(
        vscode.Uri.file(path.join(context.extensionPath, 'src', 'chat.js'))
    );
    return `
        <!DOCTYPE html>
        <html lang="zh-cn">
        <head>
            <meta charset="UTF-8">
            <title>SIG plugin</title>
            <link rel="stylesheet" href="${cssUri}">
        </head>
        <body class="vscode-dark">
            <div id="code-container">
                <div id="code-header">
                    <span>代码区</span>
                    <button id="code-toggle">折叠</button>
                </div>
                <div id="code"></div>
                <div id="code-resizer"></div>
            </div>
            <div id="chat"></div>
            <div id="input-area">
                <div id="input-box">
                    <div id="input-context-bar">
                        <button id="add-context" type="button">
                            <svg class="clip-icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
                                <path d="M4.5 8.5L8 12a2.5 2.5 0 0 0 3.5-3.5l-5-5a2 2 0 1 0-2.8 2.8l6.3 6.3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
                            </svg>
                            添加上下文...
                        </button>
                        <span id="context-filename"></span>
                    </div>
                    <textarea id="input" rows="3" placeholder="输入你的问题或需求..." autocomplete="off"></textarea>
                    <div id="input-actions">
                        <button id="stop" aria-label="停止生成" title="停止生成">
                            <svg width="22" height="22" viewBox="0 0 24 24">
                                <rect x="6" y="6" width="12" height="12" rx="3" fill="#ff5f56"/>
                            </svg>
                        </button>
                        <button id="send" aria-label="发送" title="发送">
                            <span class="icon-normal">
                                <svg width="22" height="22" viewBox="0 0 24 24"><path fill="#6a93ff" d="M2 21l21-9-21-9v7l15 2-15 2z"/></svg>
                            </span>
                            <span class="icon-loading">
                                <svg class="loading-spinner" width="22" height="22" viewBox="0 0 50 50">
                                    <circle cx="25" cy="25" r="20" fill="none" stroke="#6a93ff" stroke-width="4" stroke-linecap="round" stroke-dasharray="31.4 31.4">
                                        <animateTransform attributeName="transform" type="rotate" from="0 25 25" to="360 25 25" dur="1s" repeatCount="indefinite"/>
                                    </circle>
                                </svg>
                            </span>
                        </button>
                        <!-- 右侧其它按钮 -->
                        <button id="analyze" aria-label="分析当前代码" title="分析当前代码">
                            <svg width="20" height="20" viewBox="0 0 20 20"><path fill="#6a93ff" d="M10 2a8 8 0 1 1 0 16A8 8 0 0 1 10 2zm0 1.5A6.5 6.5 0 1 0 10 16.5 6.5 6.5 0 0 0 10 3.5zm-1 3h2v5h-2zm0 6h2v2h-2z"/></svg>
                        </button>
                        <button id="analyze-project" aria-label="分析整个项目" title="分析整个项目">
                            <svg width="20" height="20" viewBox="0 0 20 20"><path fill="#28a745" d="M10 2a8 8 0 1 1 0 16A8 8 0 0 1 10 2zm0 1.5A6.5 6.5 0 1 0 10 16.5 6.5 6.5 0 0 0 10 3.5zm-1 3h2v5h-2zm0 6h2v2h-2z"/></svg>
                        </button>
                    </div>
                </div>
            </div>
            <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
            <script src="https://cdn.jsdelivr.net/npm/highlight.js/lib/common.min.js"></script>
            <script>
                document.addEventListener('DOMContentLoaded', () => {
                    document.querySelectorAll('pre code').forEach(block => {
                        hljs.highlightElement(block);
                    });
                });
            </script>
            <script src="${jsUri}"></script>
        </body>
        </html>
    `;
}

// This method is called when your extension is deactivated
export function deactivate() {}
