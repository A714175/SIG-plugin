const vscode = acquireVsCodeApi();
const codeContainer = document.getElementById('code-container');
const codeDiv = document.getElementById('code');
const codeToggle = document.getElementById('code-toggle');
const codeResizer = document.getElementById('code-resizer');
const chat = document.getElementById('chat');
const input = document.getElementById('input');
const send = document.getElementById('send');
const analyze = document.getElementById('analyze');
const analyzeProject = document.getElementById('analyze-project');
const addContextBtn = document.getElementById('add-context');
const contextFilename = document.getElementById('context-filename');

let messages = [];
let isWaiting = false;
let currentRequestId = null;
let codeCollapsed = false;
let startY = 0;
let startHeight = 0;
let streamingDiv = null;
let streamingContent = '';

window.onload = function() {
    vscode.postMessage({ type: 'ready' });
};

// 发送按钮
send.onclick = () => {
    if (isWaiting) {
        return;
    }
    if (input.value.trim()) {
        appendBubble(input.value, 'user');
        messages.push({ role: 'user', content: input.value });
        // 生成唯一 requestId
        currentRequestId = Date.now().toString() + Math.random().toString(36).slice(2);
        vscode.postMessage({ type: 'userInput', value: input.value, messages, requestId: currentRequestId });
        input.value = '';
        chat.scrollTop = chat.scrollHeight;
        isWaiting = true;
        input.disabled = true;
        send.disabled = true;
        send.setAttribute('aria-label', '发送中...');
        send.classList.add('loading');
        showGenerating(); // 显示“正在生成...”
    }
};
input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
        // 阻止默认行为，不发送也不换行
        e.preventDefault();
    }
    // Shift+Enter 默认换行
});

analyze.onclick = () => {
    analyze.disabled = true;
    analyze.setAttribute('aria-label', '分析中...');
    analyze.classList.add('loading');
    const code = codeDiv.innerText || '';
    vscode.postMessage({ type: 'analyzeCode', code });
};

analyzeProject.onclick = () => {
    analyzeProject.disabled = true;
    analyzeProject.setAttribute('aria-label', '分析中...');
    analyzeProject.classList.add('loading');
    vscode.postMessage({ type: 'analyzeWorkspace' });
};

addContextBtn.onclick = () => {
    vscode.postMessage({ type: 'addContext' });
};

window.addEventListener('message', event => {
    const msg = event.data;
    if(msg.type === 'code') {
        codeDiv.innerHTML = `<pre><code>${msg.value.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre>`;
    }
    if(msg.type === 'apiResult') {
        hideGenerating(); // 移除“正在生成...”
        appendBubble('DeepSeek API返回结果: ' + msg.value, 'bot');
        messages.push({ role: 'assistant', content: msg.value });
        isWaiting = false;
        input.disabled = false;
        send.disabled = false;
        send.setAttribute('aria-label', '发送');
        send.classList.remove('loading');
        input.focus();
        analyze.disabled = false;
        analyze.setAttribute('aria-label', '分析当前代码');
        analyze.classList.remove('loading');
        analyzeProject.disabled = false;
        analyzeProject.setAttribute('aria-label', '分析整个项目');
        analyzeProject.classList.remove('loading');
    }
    if (msg.type === 'contextFilename') {
        contextFilename.textContent = msg.value || '';
    }
    if (msg.type === 'addContext') {
        // ...你自己的上下文逻辑...
    }
    if (msg.type === 'apiStream') {
        // 只处理当前 requestId 的流
        if (msg.requestId && msg.requestId !== currentRequestId) {
            return;
        }
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
        // 只做简单渲染，不加“应用”按钮
        if (typeof marked !== 'undefined') {
            streamingDiv.innerHTML = (marked.parse ? marked.parse(streamingContent) : marked(streamingContent));
        } else {
            streamingDiv.textContent = streamingContent;
        }
        chat.scrollTop = chat.scrollHeight;
    }
    if (msg.type === 'apiStreamEnd') {
        // 只处理当前 requestId 的流
        if (msg.requestId && msg.requestId !== currentRequestId) {
            return;
        }
        // 先移除流式div
        if (streamingDiv && streamingDiv.parentNode) {
            streamingDiv.parentNode.removeChild(streamingDiv);
        }
        // 用完整内容走你原有 appendBubble 逻辑
        appendBubble(streamingContent, 'bot');
        // 只有流式完整结束时才记忆 AI回复
        messages.push({ role: 'assistant', content: streamingContent });
        streamingDiv = null;
        streamingContent = '';
        hideGenerating();
        // ...恢复按钮状态等...
        isWaiting = false;
        input.disabled = false;
        send.disabled = false;
        send.setAttribute('aria-label', '发送');
        send.classList.remove('loading');
        input.focus();
        analyze.disabled = false;
        analyze.setAttribute('aria-label', '分析当前代码');
        analyze.classList.remove('loading');
        analyzeProject.disabled = false;
        analyzeProject.setAttribute('aria-label', '分析整个项目');
        analyzeProject.classList.remove('loading');
    }
    if (msg.type === 'stopGenerateAck') {
        // 停止后也立即恢复输入和按钮状态，允许继续发送新内容
        hideGenerating();
        isWaiting = false;
        input.disabled = false;
        send.disabled = false;
        send.setAttribute('aria-label', '发送');
        send.classList.remove('loading');
        input.focus();
        analyze.disabled = false;
        analyze.setAttribute('aria-label', '分析当前代码');
        analyze.classList.remove('loading');
        analyzeProject.disabled = false;
        analyzeProject.setAttribute('aria-label', '分析整个项目');
        analyzeProject.classList.remove('loading');
    }
});

codeToggle.onclick = () => {
    codeCollapsed = !codeCollapsed;
    if (codeCollapsed) {
        codeDiv.style.display = 'none';
        codeResizer.style.display = 'none';
        codeContainer.style.height = '40px';
        codeToggle.textContent = '展开';
    } else {
        codeDiv.style.display = 'block';
        codeResizer.style.display = 'block';
        codeContainer.style.height = '180px';
        codeToggle.textContent = '折叠';
    }
};

// 拖拉改变高度
codeResizer.onmousedown = function(e) {
    startY = e.clientY;
    startHeight = codeContainer.offsetHeight;
    document.body.style.cursor = 'ns-resize';
    document.onmousemove = function(e) {
        let newHeight = startHeight + (e.clientY - startY);
        newHeight = Math.max(40, Math.min(400, newHeight));
        codeContainer.style.height = newHeight + 'px';
    };
    document.onmouseup = function() {
        document.body.style.cursor = '';
        document.onmousemove = null;
        document.onmouseup = null;
    };
};

input.addEventListener('input', function() {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 120) + 'px';
});

function appendBubble(text, who) {
    const div = document.createElement('div');
    if (who === 'user') {
        div.className = 'bubble user';
        div.innerText = text;
    } else {
        // bot消息直接渲染，不加泡泡
        try {
            if (typeof marked !== 'undefined') {
                div.innerHTML = (marked.parse ? marked.parse(text) : marked(text));
            } else {
                // 代码块处理
                const parts = text.split(/(```[\s\S]*?```)/g);
                let html = '';
                let codeIndex = 0;
                parts.forEach(part => {
                    if (part.startsWith('```') && part.endsWith('```')) {
                        const code = part.slice(3, -3);
                        html += `<div class="copilot-bubble">
                            <pre><code>${code.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre>
                            <button class="apply-code-btn" data-code-index="${codeIndex}">应用</button>
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

    // 绑定“应用”按钮事件
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

// 生成中提示
function showGenerating() {
    const old = document.getElementById('generating-msg');
    if (old) {
        old.remove();
    }
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
    const old = document.getElementById('generating-msg');
    if (old) {
        old.remove();
    }
}

const stopBtn = document.getElementById('stop');
stopBtn.onclick = () => {
    vscode.postMessage({ type: 'stopGenerate' });
    hideGenerating(); // 立即隐藏“正在生成...”提示
    // 停止生成时不记忆本轮 AI回复
    streamingDiv = null;
    streamingContent = '';
    isWaiting = false;
    input.disabled = false;
    send.disabled = false;
    send.setAttribute('aria-label', '发送');
    send.classList.remove('loading');
};