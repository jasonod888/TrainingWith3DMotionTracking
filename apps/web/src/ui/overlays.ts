import {useCallback, useEffect, useRef, type RefObject} from 'react';

/** Shared dismiss/focus behavior for non-modal popovers and menus. */
export function useDismissablePopover({open, onClose, rootRef, triggerRef, initialFocusRef, closeOnFocusOutside = false}: {
  open: boolean;
  onClose: () => void;
  rootRef: RefObject<HTMLElement | null>;
  triggerRef: RefObject<HTMLElement | null> | null | undefined;
  initialFocusRef?: RefObject<HTMLElement | null>;
  closeOnFocusOutside?: boolean;
}) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const close = useCallback((restoreFocus = false) => {
    closeRef.current();
    if (restoreFocus) triggerRef?.current?.focus();
  }, [triggerRef]);
  useEffect(() => {
    if (!open) return;
    const initial = initialFocusRef?.current
      ?? rootRef.current?.querySelector<HTMLElement>('button:not(:disabled),input:not(:disabled),[role="menuitem"]:not(:disabled)');
    initial?.focus();
    const outside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close(false);
    };
    const focus = (event: FocusEvent) => {
      if (closeOnFocusOutside && !rootRef.current?.contains(event.target as Node)) close(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      close(true);
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', focus);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('focusin', focus);
      document.removeEventListener('keydown', key);
    };
  }, [open, close, closeOnFocusOutside, initialFocusRef, rootRef]);
  return () => close(true);
}

/** Shared dialog focus trap, Escape handling and opener restoration. */
export function useDialogBehavior({panelRef, modal, onClose, active = true}: {
  panelRef: RefObject<HTMLElement | null>;
  modal: boolean;
  onClose: () => void;
  active?: boolean;
}) {
  const opener = useRef<HTMLElement | null>(
    typeof document === 'undefined' ? null : document.activeElement as HTMLElement | null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const wasActive = useRef(false);
  // Capture before the owner's layout commit. A parent may make the stage inert or
  // blur the opener before passive effects run; only the render-time active element
  // is guaranteed to still be the control that opened the panel.
  if (active && !wasActive.current) {
    opener.current = typeof document === 'undefined' ? null : document.activeElement as HTMLElement | null;
    wasActive.current = true;
  } else if (!active) {
    wasActive.current = false;
  }
  useEffect(() => {
    if (!active) return;
    const node = panelRef.current;
    if (!node) return;
    const focusable = () => Array.from(node.querySelectorAll<HTMLElement>(
      'button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href],video[controls],textarea:not(:disabled),summary'))
      .filter(element => element.getClientRects().length);
    focusable()[0]?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
        return;
      }
      if (!modal || event.key !== 'Tab') return;
      const list = focusable(), first = list[0], last = list.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first?.focus();
      }
    };
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('keydown', key, true);
      const target = opener.current;
      if (target?.isConnected) requestAnimationFrame(() => {
        if (target.isConnected) target.focus();
      });
    };
  }, [active, modal, panelRef]);
}
