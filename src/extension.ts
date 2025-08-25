import * as path from 'path';
import * as vscode from 'vscode';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(
		vscode.commands.registerCommand('filgpt.helloWorld', () => {
			vscode.window.showInformationMessage('Hello World from FILGPT!');
		})
	);
	context.subscriptions.push(
		vscode.commands.registerCommand('filgpt.openChat', () => {
			const editor = vscode.window.activeTextEditor;
			const cachedCode = editor ? editor.document.getText() : '';
			const panel = vscode.window.createWebviewPanel(
				'filgptChat',
				'SIG plugin',
				vscode.ViewColumn.Beside,
				{ enableScripts: true, retainContextWhenHidden: true }
			);
			panel.webview.html = getChatWebviewContent(context, panel.webview);
			// 监听编辑器切换和选区变化，主动发送当前文件名
			const updateContextFilename = () => {
				const editor = vscode.window.activeTextEditor;
				const filename = editor ? path.basename(editor.document.fileName) : '';
				panel.webview.postMessage({ type: 'contextFilename', value: filename });
			};
			context.subscriptions.push(
				vscode.window.onDidChangeActiveTextEditor(updateContextFilename),
				vscode.window.onDidChangeTextEditorSelection(updateContextFilename)
			);
			updateContextFilename();
			// 监听选区变化
			context.subscriptions.push(
				vscode.window.onDidChangeTextEditorSelection(event => {
					const code = event.textEditor.document.getText();
					panel.webview.postMessage({ type: 'code', value: code });
				})
			);
			panel.webview.onDidReceiveMessage(async message => {
				const config = vscode.workspace.getConfiguration('filgpt');
				const apiKey = config.get<string>('apiKey') || '';
				const url = 'https://api.deepseek.com/chat/completions';
				if (message.type === 'ready') {
					panel.webview.postMessage({ type: 'code', value: cachedCode });
				}
				if (message.type === 'userInput') {
					if (message.model === 'deepseek') {
						const messages = message.messages || [
							{ role: "system", content: "You are a helpful assistant." },
							{ role: "user", content: message.value }
						];
						const body = { model: "deepseek-chat", messages, stream: true };
						const panelAny = panel as any;
						const requestId = Date.now().toString() + Math.random().toString(36).slice(2);
						panelAny._filgptCurrentRequestId = requestId;
						if (panelAny._filgptAbortController) { panelAny._filgptAbortController.abort(); }
						const abortController = new AbortController();
						panelAny._filgptAbortController = abortController;
						try {
							const fetch = (await import('node-fetch')).default;
							const res = await fetch(url, {
								method: 'POST',
								headers: {
									'Content-Type': 'application/json',
									'Authorization': `Bearer ${apiKey}`
								},
								body: JSON.stringify(body),
								signal: abortController.signal
							});
							if (!res.body) { throw new Error('No response body'); }
							let buffer = '';
							for await (const chunk of res.body) {
								if (panelAny._filgptCurrentRequestId !== requestId || abortController.signal.aborted) {
									panelAny._filgptAbortController = null;
									return;
								}
								const text = Buffer.isBuffer(chunk) ? chunk.toString('utf-8') : chunk;
								buffer += text;
								const lines = buffer.split('\n');
								buffer = lines.pop() || '';
								for (const line of lines) {
									const trimmed = line.trim();
									if (trimmed.startsWith('data:')) {
										const jsonStr = trimmed.replace(/^data:\s*/, '');
										if (jsonStr === '[DONE]') {
											panel.webview.postMessage({ type: 'apiStreamEnd' });
											panelAny._filgptAbortController = null;
											return;
										}
										try {
											const data = JSON.parse(jsonStr);
											const delta = data.choices?.[0]?.delta?.content;
											if (delta) { panel.webview.postMessage({ type: 'apiStream', value: delta }); }
										} catch {}
									}
								}
							}
							panel.webview.postMessage({ type: 'apiStreamEnd' });
							panelAny._filgptAbortController = null;
						} catch (err) {
							if (abortController.signal.aborted) {
								panel.webview.postMessage({ type: 'apiStreamEnd' });
								panelAny._filgptAbortController = null;
								return;
							}
							panel.webview.postMessage({ type: 'apiResult', value: 'DeepSeek接口请求失败: ' + err });
						}
					} else if (message.model === 'filgpt') {
						try {
							const fetch = (await import('node-fetch')).default;
							const res = await fetch('http://localhost:8080/generatenew', {
								method: 'POST',
								headers: {
									'Content-Type': 'application/json'
								},
								body: JSON.stringify({ userInput: message.value })
							});
							const data: any = await res.json();
							let result = '';
							if (data.text) { result += data.text + '\n\n'; }
							if (data.code) { result += '```\n' + data.code + '\n```'; }
							panel.webview.postMessage({ type: 'apiResult', value: result });
						} catch (err) {
							panel.webview.postMessage({ type: 'apiResult', value: 'FILGPT接口请求失败: ' + err });
						}
					}
				}
				if (message.type === 'analyzeCode') {
					if (message.model !== 'deepseek') {
						panel.webview.postMessage({ type: 'apiResult', value: '当前未选择 DeepSeek，未调用 API。' });
						return;
					}
					const codeToAnalyze = message.code || '';
					if (!codeToAnalyze) {
						panel.webview.postMessage({ type: 'apiResult', value: '未检测到代码内容' });
						return;
					}
					const body = {
						model: "deepseek-chat",
						messages: [
							{ role: "system", content: "你是一个专业的代码审查助手，请分析用户提供的代码并给出修改建议。" },
							{ role: "user", content: `请帮我分析以下代码并给出修改建议：\n\n${codeToAnalyze}` }
						],
						stream: false
					};
					try {
						const fetch = (await import('node-fetch')).default;
						const res = await fetch(url, {
							method: 'POST',
							headers: {
								'Content-Type': 'application/json',
								'Authorization': `Bearer ${apiKey}`
							},
							body: JSON.stringify(body)
						});
						const data: any = await res.json();
						const answer = data.choices?.[0]?.message?.content || '未获取到分析建议';
						panel.webview.postMessage({ type: 'apiResult', value: answer });
					} catch (err) {
						panel.webview.postMessage({ type: 'apiResult', value: 'DeepSeek接口请求失败: ' + err });
					}
				}
				if (message.type === 'analyzeWorkspace') {
					if (message.model !== 'deepseek') {
						panel.webview.postMessage({ type: 'apiResult', value: '当前未选择 DeepSeek，未调用 API。' });
						return;
					}
					const files = await vscode.workspace.findFiles('**/*.{js,ts,py,java,cpp,cs,go,rb}', '**/node_modules/**');
					let allCode = '';
					for (const file of files) {
						try {
							const doc = await vscode.workspace.openTextDocument(file);
							allCode += `\n\n// 文件: ${path.basename(file.fsPath)}\n${doc.getText()}`;
						} catch {}
					}
					if (!allCode) {
						panel.webview.postMessage({ type: 'apiResult', value: '未找到可分析的代码文件' });
						return;
					}
					const body = {
						model: "deepseek-chat",
						messages: [
							{ role: "system", content: "你是一个专业的代码审查助手，请分析整个项目的代码并给出修改建议。" },
							{ role: "user", content: `请分析以下项目代码并给出修改建议：\n\n${allCode}` }
						],
						stream: false
					};
					try {
						const fetch = (await import('node-fetch')).default;
						const res = await fetch(url, {
							method: 'POST',
							headers: {
								'Content-Type': 'application/json',
								'Authorization': `Bearer ${apiKey}`
							},
							body: JSON.stringify(body)
						});
						const data: any = await res.json();
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
					const panelAny = panel as any;
					if (panelAny._filgptAbortController) { panelAny._filgptAbortController.abort(); }
					panel.webview.postMessage({ type: 'stopGenerateAck' });
				}
				if (message.type === 'applyCode') {
					const editor = vscode.window.activeTextEditor;
					if (editor) {
						editor.edit(editBuilder => {
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
				if (message.type === 'downloadCode') {
					// 让用户选择保存路径
					const uri = await vscode.window.showSaveDialog({
						defaultUri: vscode.Uri.file('code.txt'),
						filters: { 'Code': ['txt', 'js', 'ts', 'py', 'java', 'cpp'] }
					});
					if (uri) {
						await vscode.workspace.fs.writeFile(uri, Buffer.from(message.value, 'utf8'));
						vscode.window.showInformationMessage('代码已保存到 ' + uri.fsPath);
					}
				}
			});
		})
	);
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
							<span class="icon-normal">
								<svg width="20" height="20" viewBox="0 0 20 20"><path fill="#6a93ff" d="M10 2a8 8 0 1 1 0 16A8 8 0 0 1 10 2zm0 1.5A6.5 6.5 0 1 0 10 16.5 6.5 6.5 0 0 0 10 3.5zm-1 3h2v5h-2zm0 6h2v2h-2z"/></svg>
							</span>
							<span class="icon-loading">
								<svg class="loading-spinner" width="20" height="20" viewBox="0 0 50 50">
									<circle cx="25" cy="25" r="20" fill="none" stroke="#6a93ff" stroke-width="5" opacity="0.2"/>
									<path fill="#6a93ff" d="M25 5a20 20 0 0 1 20 20" stroke="#6a93ff" stroke-width="5" stroke-linecap="round"/>
								</svg>
							</span>
						</button>
						<button id="analyze-project" aria-label="分析整个项目" title="分析整个项目">
							<span class="icon-normal">
								<svg width="20" height="20" viewBox="0 0 20 20"><path fill="#28a745" d="M10 2a8 8 0 1 1 0 16A8 8 0 0 1 10 2zm0 1.5A6.5 6.5 0 1 0 10 16.5 6.5 6.5 0 0 0 10 3.5zm-1 3h2v5h-2zm0 6h2v2h-2z"/></svg>
							</span>
							<span class="icon-loading">
								<svg class="loading-spinner" width="20" height="20" viewBox="0 0 50 50">
									<circle cx="25" cy="25" r="20" fill="none" stroke="#28a745" stroke-width="5" opacity="0.2"/>
									<path fill="#28a745" d="M25 5a20 20 0 0 1 20 20" stroke="#28a745" stroke-width="5" stroke-linecap="round"/>
								</svg>
							</span>
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
