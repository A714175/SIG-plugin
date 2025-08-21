
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

let messages = [], isWaiting = false, currentRequestId = null;
let codeCollapsed = false, startY = 0, startHeight = 0;
let streamingDiv = null, streamingContent = '';

window.onload = () => vscode.postMessage({ type: 'ready' });

send.onclick = () => {
    if (isWaiting || !input.value.trim()) { return; }
    appendBubble(input.value, 'user');
    messages.push({ role: 'user', content: input.value });
    currentRequestId = Date.now().toString() + Math.random().toString(36).slice(2);
    vscode.postMessage({ type: 'userInput', value: input.value, messages, requestId: currentRequestId });
    input.value = '';
    chat.scrollTop = chat.scrollHeight;
    setWaiting(true);
    showGenerating();
};

input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); }
});

analyze.onclick = () => {
    setBtnLoading(analyze, true, '分析中...');
    vscode.postMessage({ type: 'analyzeCode', code: codeDiv.innerText || '' });
};
analyzeProject.onclick = () => {
    setBtnLoading(analyzeProject, true, '分析中...');
    vscode.postMessage({ type: 'analyzeWorkspace' });
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
        appendBubble('DeepSeek API返回结果: ' + msg.value, 'bot');
        messages.push({ role: 'assistant', content: msg.value });
        setWaiting(false);
        resetBtn(analyze, '分析当前代码');
        resetBtn(analyzeProject, '分析整个项目');
    }
    if (msg.type === 'contextFilename') {
        contextFilename.textContent = msg.value || '';
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
        streamingContent += msg.value;
        if (typeof marked !== 'undefined') {
            streamingDiv.innerHTML = (marked.parse ? marked.parse(streamingContent) : marked(streamingContent));
        } else {
            streamingDiv.textContent = streamingContent;
        }
        chat.scrollTop = chat.scrollHeight;
    }
    if (msg.type === 'apiStreamEnd') {
    if (msg.requestId && msg.requestId !== currentRequestId) { return; }
    if (streamingDiv && streamingDiv.parentNode) { streamingDiv.parentNode.removeChild(streamingDiv); }
        appendBubble(streamingContent, 'bot');
        messages.push({ role: 'assistant', content: streamingContent });
        streamingDiv = null;
        streamingContent = '';
        hideGenerating();
        setWaiting(false);
        resetBtn(analyze, '分析当前代码');
        resetBtn(analyzeProject, '分析整个项目');
    }
    if (msg.type === 'stopGenerateAck') {
        hideGenerating();
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
                        const code = part.slice(3, -3);
                        html += `<div class="copilot-bubble">
                            <pre><code>${code.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre>
                            <button class="apply-code-btn" data-code-index="${codeIndex}">copy</button>
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
    div.querySelectorAll('.apply-code-btn').forEach(btn => {
        btn.onclick = function() {
            vscode.postMessage({ type: 'focusEditor' });
            setTimeout(() => {
                const code = this.previousElementSibling.textContent;
                vscode.postMessage({ type: 'applyCode', value: code });
            }, 100);
        };
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