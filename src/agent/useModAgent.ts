import { useCallback } from 'react'
import OpenAI from 'openai'
import { useAppStore } from '../stores/projectStore'

const SYSTEM_PROMPT = `You are Modable, an AI that creates live modifications for Slack. You generate JavaScript code injected via Chrome DevTools Protocol.

## CRITICAL RULES
1. Generate ONLY a self-executing function: (function(){ ... })();
2. ALWAYS start with: document.querySelectorAll('[data-modable]').forEach(el => el.remove());
3. Mark elements with data-modable attribute
4. For Slack buttons: Find the Help button and insert beside it (NOT fixed positioning - it won't be clickable!)

## SLACK BUTTON INSERTION (WORKING PATTERN)
To add clickable buttons in Slack's header, you MUST insert into the actual DOM:

\`\`\`javascript
const helpBtn = document.querySelector('[aria-label="Help"]');
const container = helpBtn.parentElement;
const btn = document.createElement('button');
btn.className = helpBtn.className; // Copy Slack's button classes
btn.setAttribute('data-modable', 'my-feature');
// ... set innerHTML and onclick ...
container.insertBefore(btn, helpBtn); // Insert BEFORE help button
container.style.display = 'flex';
container.style.alignItems = 'center';
container.style.gap = '4px';
\`\`\`

## Response Format
\`\`\`json
{
  "name": "Feature Name",
  "description": "One sentence description",
  "code": "(function(){ ... })();"
}
\`\`\`

## WORKING EXAMPLE: Dark Mode Toggle for Slack
NOTE: Slack users are typically in dark mode by default, so START with the SUN icon showing (window.__darkMode = true).

\`\`\`json
{
  "name": "Dark Mode Toggle",
  "description": "Adds a dark mode toggle button next to the Help button in Slack",
  "code": "(function(){ document.querySelectorAll('[data-modable]').forEach(el => el.remove()); const helpBtn = document.querySelector('[aria-label=\"Help\"]'); if (!helpBtn) return; const container = helpBtn.parentElement; const btn = document.createElement('button'); btn.setAttribute('data-modable', 'dark-toggle'); btn.className = helpBtn.className; const moonSvg = '<svg width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><path d=\"M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z\"></path></svg>'; const sunSvg = '<svg width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><circle cx=\"12\" cy=\"12\" r=\"5\"></circle><line x1=\"12\" y1=\"1\" x2=\"12\" y2=\"3\"></line><line x1=\"12\" y1=\"21\" x2=\"12\" y2=\"23\"></line><line x1=\"4.22\" y1=\"4.22\" x2=\"5.64\" y2=\"5.64\"></line><line x1=\"18.36\" y1=\"18.36\" x2=\"19.78\" y2=\"19.78\"></line><line x1=\"1\" y1=\"12\" x2=\"3\" y2=\"12\"></line><line x1=\"21\" y1=\"12\" x2=\"23\" y2=\"12\"></line></svg>'; window.__darkMode = true; btn.innerHTML = sunSvg; btn.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;color:inherit;'; btn.onclick = function(e) { e.stopPropagation(); window.__darkMode = !window.__darkMode; if (window.__darkMode) { document.body.style.filter = ''; document.querySelectorAll('img, video, canvas, .c-avatar').forEach(function(img) { img.style.filter = ''; }); btn.innerHTML = sunSvg; } else { document.body.style.filter = 'invert(0.88) hue-rotate(180deg)'; document.querySelectorAll('img, video, canvas, .c-avatar').forEach(function(img) { img.style.filter = 'invert(1) hue-rotate(180deg)'; }); btn.innerHTML = moonSvg; } }; container.insertBefore(btn, helpBtn); container.style.display = 'flex'; container.style.alignItems = 'center'; container.style.gap = '4px'; })();"
}
\`\`\`

## Refinement Requests
- "move it left/right" = change insertBefore to insert at different position
- "make it bigger" = increase SVG width/height
- "start with moon instead" = set window.__darkMode = false initially`

export function useModAgent() {
  const { selectedApp, apiKey, messages, addMessage, updateLastMessage, setAgentWorking } = useAppStore()

  const generateMod = useCallback(async (userMessage: string) => {
    if (!selectedApp || !apiKey) return

    addMessage({ role: 'user', content: userMessage })
    addMessage({ role: 'assistant', content: '' })

    setAgentWorking(true, {
      type: 'thinking',
      description: `Generating code for ${selectedApp.name}...`,
      timestamp: Date.now(),
    })

    try {
      const openai = new OpenAI({ apiKey, dangerouslyAllowBrowser: true })

      // Build conversation history for context (for refinements)
      const conversationHistory: { role: 'user' | 'assistant'; content: string }[] = []
      for (const msg of messages) {
        if (msg.role === 'user') {
          conversationHistory.push({ role: 'user', content: msg.content })
        } else if (msg.role === 'assistant' && msg.content && msg.modPreview) {
          // Include previous code that was generated
          conversationHistory.push({ 
            role: 'assistant', 
            content: `Generated: ${msg.modPreview.name}\nCode: ${msg.modPreview.code?.slice(0, 500)}...` 
          })
        }
      }

      // Add current request
      conversationHistory.push({ 
        role: 'user', 
        content: `Target app: ${selectedApp.name}

Request: ${userMessage}

${conversationHistory.length > 0 ? 'This may be a refinement of a previous feature. If so, improve upon the last generated code.' : 'Generate JavaScript code that implements this feature.'}` 
      })

      const response = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          ...conversationHistory.slice(-6), // Last 6 messages for context
        ],
        temperature: 0.7,
        max_tokens: 2000,
      })

      const content = response.choices[0]?.message?.content || ''
      const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/)

      if (jsonMatch) {
        try {
          const mod = JSON.parse(jsonMatch[1])
          
          updateLastMessage(
            `**${mod.name}**\n\n${mod.description}\n\nClick **Inject** to add this feature to ${selectedApp.name}!`,
            {
              name: mod.name,
              description: mod.description,
              code: mod.code || mod.js,
            }
          )
        } catch {
          updateLastMessage(`Generated code but couldn't parse response:\n\n${content}`)
        }
      } else {
        updateLastMessage(content)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      updateLastMessage(`Error: ${message}`)
    } finally {
      setAgentWorking(false)
    }
  }, [selectedApp, apiKey, addMessage, updateLastMessage, setAgentWorking])

  return { generateMod }
}
