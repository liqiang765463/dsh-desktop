/** Fixed, bounded page operations. No caller-supplied JavaScript, OS input, clipboard or focus. */
export async function windowPage(request: Record<string, any>): Promise<unknown> {
  const global = globalThis as any
  if (location.protocol !== 'dsh-app:' || location.hostname !== 'app') throw new Error('UNSUPPORTED_SURFACE: only the owned DSH document can be controlled')
  const state = global.__DSH_WINDOW_DRIVER_V1 ??= { documentId: crypto.randomUUID(), elements: new Map(), observation: '' }
  const name = (el: Element): string => (el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('placeholder')
    || (el as HTMLElement).innerText || el.textContent || '').replace(/\s+/gu, ' ').trim().slice(0, 180)
  const visible = (el: Element): boolean => {
    const box = el.getBoundingClientRect(), style = getComputedStyle(el)
    return box.width > 0 && box.height > 0 && box.top < innerHeight && box.bottom > 0 && box.left < innerWidth && box.right > 0
      && style.visibility !== 'hidden' && style.display !== 'none'
  }
  if (request.action === 'snapshot') {
    if (!document.querySelector('button,input,[contenteditable="true"]')) await new Promise<void>(resolve => {
      const observer = new MutationObserver(() => {
        if (document.querySelector('button,input,[contenteditable="true"]')) { clearTimeout(timer); observer.disconnect(); resolve() }
      })
      const timer = setTimeout(() => { observer.disconnect(); resolve() }, 10_000)
      observer.observe(document.documentElement, { childList: true, subtree: true })
    })
    state.elements = new Map(); state.observation = request.observation
    const nodes = [...document.querySelectorAll('button,a,input,textarea,select,[contenteditable="true"],[role="button"],[role="tab"],[role="treeitem"],[role="row"],[role="combobox"],[role="option"],[role="menuitem"],summary')]
      .filter(visible).slice(0, 400).map((el, index) => {
        const id = index + 1, label = name(el), role = el.getAttribute('role') || el.tagName.toLowerCase()
        state.elements.set(id, { el, label, role })
        const input = el as HTMLInputElement
        return { id, role, name: label, disabled: !!input.disabled,
          ...(el.matches('input,textarea,select') ? { value: input.type === 'password' ? '[redacted]' : String(input.value).slice(0, 1000) } : {}),
          ...(el.matches('select') ? { options: [...(el as HTMLSelectElement).options].slice(0, 150).map(option => ({ value: option.value, name: option.text })) } : {}),
          ...(el.getAttribute('aria-selected') !== null ? { selected: el.getAttribute('aria-selected') } : {}),
        }
      })
    return { documentId: state.documentId, title: document.title, text: document.body.innerText.slice(0, 14000), nodes,
      unsupportedFrames: document.querySelectorAll('webview,iframe').length }
  }
  if (request.documentId !== state.documentId || request.observation !== state.observation) throw new Error('STALE_SNAPSHOT: read this window again')
  const record = state.elements.get(request.node)
  if (!record || !record.el.isConnected || name(record.el) !== record.label || !visible(record.el)) throw new Error('STALE_TARGET: the observed control changed')
  const el = record.el as HTMLElement
  if ((el as HTMLInputElement).disabled) throw new Error('CONTROL_DISABLED')
  if (el.closest('iframe,webview')) throw new Error('UNSUPPORTED_SURFACE: no global desktop fallback')
  const globalAction = /^(?:退出(?:并重启)?|重启(?:应用|后台|工作环境)?|恢复出厂设置|Quit(?: and Restart)?|Restart(?: Application| Host)?|Factory Reset)$/iu
  if (globalAction.test(record.label)) throw new Error('SHARED_APP_ACTION: this operation affects all windows and is not exposed by the bound tool')
  state.observation = '' // Consume an observation before dispatch; an uncertain action is never replayed.
  if (request.action === 'click') {
    const anchor = el.closest('a')
    if (anchor?.href && !anchor.href.startsWith('dsh-app://app/')) throw new Error('UNSUPPORTED_SURFACE: external navigation is outside this window binding')
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse', button: 0 }))
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
    el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse', button: 0 }))
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }))
    el.click()
  } else if (request.action === 'fill') {
    if (typeof request.text !== 'string' || request.text.length > 100_000) throw new Error('Invalid input text')
    if (el.matches('input[type="password"]')) throw new Error('PASSWORD_INPUT_NOT_EXPOSED')
    if (el.matches('input,textarea')) {
      const setter = Object.getOwnPropertyDescriptor(el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')?.set
      setter?.call(el, request.text)
    } else if (el.isContentEditable) {
      el.focus()
      const selection = getSelection(); selection?.selectAllChildren(el)
      if (!document.execCommand('insertText', false, request.text)) throw new Error('EDITOR_INPUT_UNSUPPORTED: no desktop fallback')
    }
    else throw new Error('NOT_EDITABLE')
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: request.text }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  } else if (request.action === 'select') {
    if (!el.matches('select') || ![...(el as HTMLSelectElement).options].some(option => option.value === request.value)) throw new Error('OPTION_NOT_OBSERVED')
    ;(el as HTMLSelectElement).value = request.value
    el.dispatchEvent(new Event('change', { bubbles: true }))
  } else if (request.action === 'scroll') {
    if (!Number.isFinite(request.y) || Math.abs(request.y) > 3000) throw new Error('Invalid scroll distance')
    let scroll: Element | null = el
    while (scroll && !(scroll.scrollHeight > scroll.clientHeight && /auto|scroll/u.test(getComputedStyle(scroll).overflowY))) scroll = scroll.parentElement
    ;(scroll ?? document.scrollingElement)?.scrollBy({ top: request.y })
  } else throw new Error('UNSUPPORTED_ACTION')
  return { documentId: state.documentId, dispatched: true, action: request.action }
}
