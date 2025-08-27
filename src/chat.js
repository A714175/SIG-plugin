const $ = id => document.getElementById(id);
const vscode = acquireVsCodeApi();
const codeContainer = $('code-container');
const codeDiv = $('code');
const codeToggle = $('code-toggle');
const codeResizer = $('code-resizer');
const chat = $('chat');
const input = $('input');
const send = $('send');
const analyze = $('analyze');
const analyzeProject = $('analyze-project');
const addContextBtn = $('add-context');
const contextFilename = $('context-filename');
const stopBtn = $('stop');
let pauseBtn = null;
let isPaused = false;
let pausedStreamBuffer = '';
let messages = [], isWaiting = false, currentRequestId = null;
let codeCollapsed = false, startY = 0, startHeight = 0;
let streamingDiv = null, streamingContent = '';

window.onload = () => {
    vscode.postMessage({ type: 'ready' });
    const inputActions = document.getElementById('input-actions');
    if (inputActions && !document.getElementById('model-select')) {
        const select = document.createElement('select');
        select.id = 'model-select';
        select.setAttribute('aria-label', '选择模型');
        select.style.border = 'none';
        select.style.background = 'none';
        select.style.color = '#fff';
        select.style.borderRadius = '6px';
        select.style.padding = '2px 28px 2px 10px';
        select.style.fontSize = '14px';
        select.style.height = '32px';
        select.style.outline = 'none';
        select.style.cursor = 'pointer';
        select.style.boxShadow = 'none';
        select.style.appearance = 'none';
        select.style.webkitAppearance = 'none';
        select.style.MozAppearance = 'none';
        select.style.position = 'relative';
        const arrow = document.createElement('span');
        arrow.innerHTML = '&#9662;';
        arrow.style.position = 'absolute';
        arrow.style.right = '10px';
        arrow.style.top = '50%';
        arrow.style.transform = 'translateY(-50%)';
        arrow.style.pointerEvents = 'none';
        arrow.style.color = '#aaa';
        arrow.style.fontSize = '13px';
        const filgpt = document.createElement('option');
        filgpt.value = 'filgpt';
        filgpt.textContent = 'filgpt';
        const deepseek = document.createElement('option');
        deepseek.value = 'deepseek';
        deepseek.textContent = 'deepseek';
        select.appendChild(filgpt);
        select.appendChild(deepseek);
        const wrapper = document.createElement('div');
        wrapper.style.display = 'flex';
        wrapper.style.alignItems = 'center';
        wrapper.style.justifyContent = 'flex-start';
        wrapper.style.position = 'relative';
        wrapper.style.marginRight = '8px';
        wrapper.appendChild(select);
        wrapper.appendChild(arrow);
        inputActions.insertBefore(wrapper, inputActions.firstChild);
    }
};

send.onclick = () => {
    if (isWaiting || !input.value.trim()) { return; }
    appendBubble(input.value, 'user');
    messages.push({ role: 'user', content: input.value });
    currentRequestId = Date.now().toString() + Math.random().toString(36).slice(2);
    // 获取当前模型选择
    const modelSelect = document.getElementById('model-select');
    const model = modelSelect ? modelSelect.value : 'filgpt';
    vscode.postMessage({ type: 'userInput', value: input.value, messages, requestId: currentRequestId, model });
    input.value = '';
    chat.scrollTop = chat.scrollHeight;
    setWaiting(true);
    showGenerating();
    showPauseBtn();
};

input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); }
});

analyze.onclick = () => {
    setBtnLoading(analyze, true, '分析中...');
    const modelSelect = document.getElementById('model-select');
    const model = modelSelect ? modelSelect.value : 'filgpt';
    vscode.postMessage({ type: 'analyzeCode', code: codeDiv.innerText || '', model });
};

analyzeProject.onclick = () => {
    setBtnLoading(analyzeProject, true, '分析中...');
    const modelSelect = document.getElementById('model-select');
    const model = modelSelect ? modelSelect.value : 'filgpt';
    vscode.postMessage({ type: 'analyzeWorkspace', model });
};

addContextBtn.onclick = () => vscode.postMessage({ type: 'addContext' });

stopBtn.onclick = () => {
    vscode.postMessage({ type: 'stopGenerate' });
    hideGenerating();
    streamingDiv = null;
    streamingContent = '';
    setWaiting(false);
};

input.addEventListener('input', function() {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 120) + 'px';
});

function showPauseBtn() {
    if (pauseBtn) { return; }
    const inputActions = document.getElementById('input-actions');
    pauseBtn = document.createElement('button');
    pauseBtn.id = 'pause';
    pauseBtn.style.marginRight = '0';
    pauseBtn.className = stopBtn.className;
    inputActions.insertBefore(pauseBtn, stopBtn);
    setPauseBtnState('pause');
}

function setPauseBtnState(state) {
    if (!pauseBtn) { return; }
    if (state === 'pause') {
        pauseBtn.setAttribute('aria-label', '暂停生成');
        pauseBtn.setAttribute('title', '暂停生成');
        pauseBtn.innerHTML = `
            <svg width="22" height="22" viewBox="0 0 24 24">
                <rect x="6" y="6" width="3.5" height="12" rx="2" fill="#ffbe2e"/>
                <rect x="14.5" y="6" width="3.5" height="12" rx="2" fill="#ffbe2e"/>
            </svg>
        `;
        pauseBtn.onclick = () => {
            isPaused = true;
            setPauseBtnState('resume');
        };
    } else if (state === 'resume') {
        pauseBtn.setAttribute('aria-label', '继续生成');
        pauseBtn.setAttribute('title', '继续生成');
        pauseBtn.innerHTML = `
            <svg width="22" height="22" viewBox="0 0 24 24">
                <path fill="#ffbe2e" d="M2 21l21-9-21-9v7l15 2-15 2z"/>
            </svg>
        `;
        pauseBtn.onclick = () => {
            isPaused = false;
            // 恢复输出暂停期间的内容
            if (streamingDiv && pausedStreamBuffer) {
                if (typeof marked !== 'undefined') {
                    streamingDiv.innerHTML = (marked.parse ? marked.parse(streamingContent + pausedStreamBuffer) : marked(streamingContent + pausedStreamBuffer));
                } else {
                    streamingDiv.textContent = streamingContent + pausedStreamBuffer;
                }
                streamingContent += pausedStreamBuffer;
                pausedStreamBuffer = '';
            }
            setPauseBtnState('pause');
        };
    }
}

function hidePauseBtn() {
    if (pauseBtn && pauseBtn.parentNode) {
        pauseBtn.parentNode.removeChild(pauseBtn);
        pauseBtn = null;
        isPaused = false;
        pausedStreamBuffer = '';
    }
}

codeToggle.onclick = () => {
    codeCollapsed = !codeCollapsed;
    codeDiv.style.display = codeCollapsed ? 'none' : 'block';
    codeResizer.style.display = codeCollapsed ? 'none' : 'block';
    codeContainer.style.height = codeCollapsed ? '40px' : '180px';
    codeToggle.textContent = codeCollapsed ? '展开' : '折叠';
};

codeResizer.onmousedown = function(e) {
    startY = e.clientY;
    startHeight = codeContainer.offsetHeight;
    document.body.style.cursor = 'ns-resize';
    document.onmousemove = function(e) {
        let newHeight = startHeight + (e.clientY - startY);
        codeContainer.style.height = Math.max(40, Math.min(400, newHeight)) + 'px';
    };
    document.onmouseup = function() {
        document.body.style.cursor = '';
        document.onmousemove = null;
        document.onmouseup = null;
    };
};

window.addEventListener('message', event => {
    const msg = event.data;
    if (msg.type === 'code') {
        codeDiv.innerHTML = `<pre><code>${msg.value.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre>`;
    }
    if (msg.type === 'apiResult') {
        hideGenerating();
        hidePauseBtn();
        appendBubble(msg.value, 'bot');
        messages.push({ role: 'assistant', content: msg.value });
        setWaiting(false);
        resetBtn(analyze, '分析当前代码');
        resetBtn(analyzeProject, '分析整个项目');
    }
    if (msg.type === 'contextFilename') {
        // 文件名管理优化：fixedFiles为已固定，currentFile为当前未固定
    if (!window._fixedFiles) { window._fixedFiles = []; }
    if (typeof window._currentFile === 'undefined') { window._currentFile = ''; }
        let fixedFiles = window._fixedFiles;
        let currentFile = window._currentFile;
        // 处理新消息
        if (Array.isArray(msg.value)) {
            if (msg.value.length > 0) {
                // 多选时，第一个为currentFile，其余加入fixedFiles
                let first = msg.value[0];
                let rest = msg.value.slice(1);
                // 如果first已固定，则currentFile为空
                if (fixedFiles.includes(first)) {
                    currentFile = '';
                } else {
                    currentFile = first;
                }
                rest.forEach(f => {
                    if (!fixedFiles.includes(f)) { fixedFiles.push(f); }
                });
            } else {
                currentFile = '';
            }
        } else if (typeof msg.value === 'string') {
            // 单选
            if (msg.value && !fixedFiles.includes(msg.value)) {
                currentFile = msg.value;
            } else {
                currentFile = '';
            }
        }
        window._currentFile = currentFile;
        window._fixedFiles = fixedFiles;
        // 渲染
        contextFilename.innerHTML = '';
        // 固定文件名（非斜体，x号）
        fixedFiles.forEach((name, idx) => {
            const tag = document.createElement('span');
            tag.className = 'context-tag';
            tag.textContent = name;
            tag.style.fontStyle = 'normal';
            // x 按钮
            const closeBtn = document.createElement('button');
            closeBtn.className = 'context-tag-close';
            closeBtn.innerHTML = '&times;';
            closeBtn.onclick = function(e) {
                e.stopPropagation();
                fixedFiles.splice(idx, 1);
                window._fixedFiles = fixedFiles;
                vscode.postMessage({ type: 'removeContextFile', value: name }); // 新增这一行
                // 如果当前currentFile为空，则尝试恢复为最后一个被删除的文件名（可选优化，实际可不恢复）
                // window._currentFile = '';
                // 重新渲染
                window.dispatchEvent(new MessageEvent('message', { data: { type: 'contextFilename', value: window._currentFile || '' } }));
            };
            tag.appendChild(closeBtn);
            contextFilename.appendChild(tag);
        });
        // 当前未固定文件名（斜体，+号）
        if (currentFile) {
            const tag = document.createElement('span');
            tag.className = 'context-tag';
            tag.textContent = currentFile;
            tag.style.fontStyle = 'italic';
            // + 按钮
            const plusBtn = document.createElement('button');
            plusBtn.className = 'context-tag-close';
            plusBtn.innerHTML = '+';
            plusBtn.onclick = function(e) {
                e.stopPropagation();
                if (!fixedFiles.includes(currentFile)) { fixedFiles.push(currentFile); }
                window._fixedFiles = fixedFiles;
                window._currentFile = '';
                // 重新渲染
                window.dispatchEvent(new MessageEvent('message', { data: { type: 'contextFilename', value: '' } }));
            };
            tag.appendChild(plusBtn);
            contextFilename.appendChild(tag);
        }
    }
    if (msg.type === 'apiStream') {
        if (msg.requestId && msg.requestId !== currentRequestId) { return; }
        if (!streamingDiv) {
            streamingDiv = document.createElement('div');
            streamingDiv.className = 'bot-streaming';
            streamingDiv.style.whiteSpace = 'pre-wrap';
            streamingDiv.style.color = '#fff';
            streamingDiv.style.fontSize = '15px';
            streamingDiv.style.margin = '8px 0';
            streamingContent = '';
            chat.appendChild(streamingDiv);
        }
        if (isPaused) {
            pausedStreamBuffer += msg.value;
        } else {
            streamingContent += msg.value;
            if (typeof marked !== 'undefined') {
                streamingDiv.innerHTML = (marked.parse ? marked.parse(streamingContent) : marked(streamingContent));
            } else {
                streamingDiv.textContent = streamingContent;
            }
            chat.scrollTop = chat.scrollHeight;
        }
    }
    if (msg.type === 'apiStreamEnd') {
        if (msg.requestId && msg.requestId !== currentRequestId) { return; }
        if (streamingDiv && streamingDiv.parentNode) { streamingDiv.parentNode.removeChild(streamingDiv); }
        appendBubble(streamingContent, 'bot');
        messages.push({ role: 'assistant', content: streamingContent });
        streamingDiv = null;
        streamingContent = '';
        hideGenerating();
        hidePauseBtn();
        setWaiting(false);
        resetBtn(analyze, '分析当前代码');
        resetBtn(analyzeProject, '分析整个项目');
    }
    if (msg.type === 'stopGenerateAck') {
        hideGenerating();
        hidePauseBtn();
        setWaiting(false);
        resetBtn(analyze, '分析当前代码');
        resetBtn(analyzeProject, '分析整个项目');
    }
});

function setWaiting(waiting) {
    isWaiting = waiting;
    input.disabled = waiting;
    send.disabled = waiting;
    send.setAttribute('aria-label', waiting ? '发送中...' : '发送');
    send.classList.toggle('loading', waiting);
    if (!waiting) { input.focus(); }
}

function setBtnLoading(btn, loading, label) {
    btn.disabled = loading;
    btn.setAttribute('aria-label', label);
    btn.classList.toggle('loading', loading);
    // 只显示 loading icon
    const iconNormal = btn.querySelector('.icon-normal');
    const iconLoading = btn.querySelector('.icon-loading');
    if (iconNormal && iconLoading) {
        iconNormal.style.display = loading ? 'none' : 'inline-block';
        iconLoading.style.display = loading ? 'inline-block' : 'none';
    }
}

function resetBtn(btn, label) {
    setBtnLoading(btn, false, label);
}

function appendBubble(text, who) {
    const div = document.createElement('div');
    if (who === 'user') {
        div.className = 'bubble user';
        div.innerText = text;
    } else {
        try {
            if (typeof marked !== 'undefined') {
                div.innerHTML = (marked.parse ? marked.parse(text) : marked(text));
            } else {
                const parts = text.split(/(```[\s\S]*?```)/g);
                let html = '', codeIndex = 0;
                parts.forEach(part => {
                    if (part.startsWith('```') && part.endsWith('```')) {
                        let codeBlock = part.slice(3, -3);
                        let lang = '';
                        const firstLineBreak = codeBlock.indexOf('\n');
                        if (firstLineBreak !== -1) {
                            lang = codeBlock.slice(0, firstLineBreak).trim();
                            codeBlock = codeBlock.slice(firstLineBreak + 1);
                        }
                        html += `
                        <div>${lang}</div>
                        <div class="copilot-bubble">
                            <pre><code class="language-${lang}">${codeBlock.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre>

                        </div>`;
                        codeIndex++;
                    } else if (part.trim() !== '') {
                        html += `<div>${part.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')}</div>`;
                    }
                });
                div.innerHTML = html;
            }
        } catch (e) {
            div.innerText = text;
            console.error('marked parse error:', e);
        }
    }
    chat.appendChild(div);
    chat.scrollTop = chat.scrollHeight;
    // 动态插入 copy 按钮
    div.querySelectorAll('.copilot-bubble').forEach((bubble, idx) => {
        if (!bubble.querySelector('.apply-code-btn')) {
            const copyBtn = document.createElement('button');
            copyBtn.className = 'apply-code-btn';
            copyBtn.textContent = 'copy';
            copyBtn.setAttribute('data-code-index', idx);
            copyBtn.style.marginLeft = '8px';
            copyBtn.onclick = function() {
                const code = bubble.querySelector('pre code').textContent;
                // 尝试使用 Clipboard API 复制到剪贴板
                if (navigator && navigator.clipboard) {
                    navigator.clipboard.writeText(code).then(() => {
                        // 可选：提示复制成功
                        vscode.postMessage({ type: 'showInfo', value: '代码已复制到剪贴板' });
                    }).catch(() => {
                        vscode.postMessage({ type: 'showWarning', value: '复制失败，请手动复制' });
                    });
                } else {
                    // 兼容性处理：创建临时 textarea
                    const textarea = document.createElement('textarea');
                    textarea.value = code;
                    document.body.appendChild(textarea);
                    textarea.select();
                    try {
                        document.execCommand('copy');
                        vscode.postMessage({ type: 'showInfo', value: '代码已复制到剪贴板' });
                    } catch {
                        vscode.postMessage({ type: 'showWarning', value: '复制失败，请手动复制' });
                    }
                    document.body.removeChild(textarea);
                }
            };
            bubble.appendChild(copyBtn);
        }
    });
    // 已在动态插入 download 按钮时绑定事件，无需重复绑定
    // 新增 download 按钮，UI 与 copy 按钮一致
    div.querySelectorAll('.copilot-bubble').forEach(bubble => {
        // 检查是否已存在 download 按钮，避免重复添加
        if (!bubble.querySelector('.download-code-btn')) {
            const downloadBtn = document.createElement('button');
            downloadBtn.className = 'download-code-btn';
            downloadBtn.textContent = 'download';
            downloadBtn.style.marginLeft = '8px';
            // 复制 copy 按钮的样式
            const copyBtn = bubble.querySelector('.apply-code-btn');
            if (copyBtn) {
                downloadBtn.style.cssText += copyBtn.style.cssText;
            }
            downloadBtn.onclick = function() {
                const code = bubble.querySelector('pre code').textContent;
                vscode.postMessage({ type: 'downloadCode', value: code });
            };
            bubble.appendChild(downloadBtn);
        }
    });
}

function showGenerating() {
    const old = $('generating-msg');
    if (old) { old.remove(); }
    const div = document.createElement('div');
    div.id = 'generating-msg';
    div.textContent = '正在生成...';
    div.style.color = '#999';
    div.style.fontSize = '13px';
    div.style.margin = '8px 0 8px 0';
    div.style.textAlign = 'left';
    chat.appendChild(div);
    chat.scrollTop = chat.scrollHeight;
}

function hideGenerating() {
    const old = $('generating-msg');
    if (old) { old.remove(); }
}