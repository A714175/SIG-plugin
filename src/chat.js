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
        select.style.textAlign = 'right';
        select.style.paddingRight = '22px';
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

        // ===新增：监听模型切换，控制“分析整个项目”按钮显示===
        const analyzeProjectBtn =document.getElementById('analyze-project');
        select.addEventListener('change', function() {
            if (this.value === 'filgpt') {
                analyzeProjectBtn.style.display = 'none';
            } else {
                analyzeProjectBtn.style.display = '';
            }
        });
        // 初始化时也执行一次
        select.dispatchEvent(new Event('change'));
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
    // TODO 因为filgpt接口不支持暂停，暂时隐藏暂停按钮
    const modelSelect = document.getElementById('model-select');
    const model = modelSelect ? modelSelect.value : 'filgpt';
    if (model === 'filgpt') { 
        hidePauseBtn();
        return; 
    }
    if (pauseBtn) { return; }
    const inputActions = document.getElementById('input-actions');
    pauseBtn = document.createElement('button');
    pauseBtn.id = 'pause';
    pauseBtn.style.marginRight = '0';
    pauseBtn.className = stopBtn.className;
    inputActions.insertBefore(pauseBtn, stopBtn);
    setPauseBtnState('pause');
}

// 监听模型切换，动态隐藏/显示暂停按钮
document.addEventListener('DOMContentLoaded', ()=>{
    const modelSelect = document.getElementById('model-select');
    if (modelSelect) {
        modelSelect.addEventListener('change', ()=> {
            if(modelSelect.value === 'filgpt') {
                hidePauseBtn();
            }
        });
    }
});

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
        // 缓存 fileName 到 window 变量
        if (msg.fileName) {
            window._lastApiFileName = msg.fileName;
        } else {
            window._lastApiFileName = undefined;
        }
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
            closeBtn.style.width = '22px';
            closeBtn.style.height = '22px';
            closeBtn.style.fontSize = '18px';
            closeBtn.style.lineHeight = '22px';
            closeBtn.style.border = 'none';
            closeBtn.style.background = 'transparent';
            closeBtn.style.cursor = 'pointer';
            closeBtn.style.display = 'inline-flex';
            closeBtn.style.alignItems = 'center';
            closeBtn.style.justifyContent = 'center';
            closeBtn.style.marginLeft = '4px';
            closeBtn.onclick = function(e) {
                e.stopPropagation();
                fixedFiles.splice(idx, 1);
                window._fixedFiles = fixedFiles;
                vscode.postMessage({ type: 'removeContextFile', value: name });
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
            plusBtn.style.width = '22px';
            plusBtn.style.height = '22px';
            plusBtn.style.fontSize = '18px';
            plusBtn.style.lineHeight = '22px';
            plusBtn.style.border = 'none';
            plusBtn.style.background = 'transparent';
            plusBtn.style.cursor = 'pointer';
            plusBtn.style.display = 'inline-flex';
            plusBtn.style.alignItems = 'center';
            plusBtn.style.justifyContent = 'center';
            plusBtn.style.marginLeft = '4px';
            plusBtn.onclick = function(e) {
                e.stopPropagation();
                if (!fixedFiles.includes(currentFile)) { fixedFiles.push(currentFile); }
                window._fixedFiles = fixedFiles;
                // 通知后端将当前活动文件内容加入已固定上下文文件列表
                vscode.postMessage({ type: 'fixCurrentContextFile', value: currentFile });
                window._currentFile = '';
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
                // div.innerHTML = (marked.parse ? marked.parse(text) : marked(text));
                //  div.innerHTML = `<div class="copilot-bubble">${marked.parse ? marked.parse(text) : marked(text)}</div>`;
                // 1.用marked渲染
                let html = marked.parse ? marked.parse(text) : marked(text);

                // 2.用DOMParser解析
                const parser = new DOMParser();
                const doc = parser.parseFromString(html,'text/html');
                // 3.遍历所有<pre><code>
                doc.querySelectorAll('pre').forEach(pre=>{
                    const bubble = doc.createElement('div');
                    bubble.className = 'copilot-bubble';
                    pre.parentElement.replaceChild(bubble, pre);
                    bubble.appendChild(pre);
                });
                // 4.设置 innerHtml
                div.innerHTML = doc.body.innerHTML;
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
        if (!bubble.querySelector('.copy-code-btn')) {
            const copyBtn = document.createElement('button');
            copyBtn.className = 'copy-code-btn';
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
            const copyBtn = bubble.querySelector('.copy-code-btn');
            if (copyBtn) {
                downloadBtn.style.cssText += copyBtn.style.cssText;
            }
            downloadBtn.onclick = function() {
                const code = bubble.querySelector('pre code').textContent;
                // 带上 fileName 字段
                vscode.postMessage({ type: 'downloadCode', value: code, fileName: window._lastApiFileName });
            };
            bubble.appendChild(downloadBtn);
        }
    });
    // 新增 apply 按钮，UI 与 copy 按钮一致
    div.querySelectorAll('.copilot-bubble').forEach(bubble => {
        if (!bubble.querySelector('.apply-code-btn')) {
            const applyBtn = document.createElement('button');
            applyBtn.className = 'apply-code-btn';
            applyBtn.textContent = 'apply';
            applyBtn.style.marginLeft = '8px';
            // 复制 copy 按钮的样式
            const copyBtn = bubble.querySelector('.copy-code-btn');
            if (copyBtn) {
                applyBtn.style.cssText += copyBtn.style.cssText;
            }
            applyBtn.onclick = function() {
                const code = bubble.querySelector('pre code').textContent;
                vscode.postMessage({ type: 'applyCode', value: code });
            };
            // 插入到 downloadBtn 之后
            const downloadBtn = bubble.querySelector('.download-code-btn');
            if (downloadBtn && downloadBtn.nextSibling) {
                bubble.insertBefore(applyBtn, downloadBtn.nextSibling);
            } else {
                bubble.appendChild(applyBtn);
            }
        }
    });
    // ===新增分割符 ===
    if (who === 'bot') {
       const divider = document.createElement('div');
       divider.style.borderTop = '1px dashed #444';
       divider.style.margin = '18px 0 12px 0';
       divider.style.height = '0';
       divider.style.width = '100%';
       divider.setAttribute('aria-hidden', 'true');
       chat.appendChild(divider);
    }
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