import {forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type SelectHTMLAttributes} from 'react';
import './tokens.css';
import './controls.css';

export type ButtonVariant =
  | 'app-primary' | 'app-primary-large' | 'app-secondary' | 'app-secondary-large' | 'nav' | 'feed-chip' | 'feed-create' | 'app-back'
  | 'feed-sign-in' | 'feed-profile' | 'feed-menu-row' | 'feed-title' | 'feed-thumbnail' | 'plain'
  | 'watch-cta' | 'watch-control' | 'watch-section' | 'watch-related' | 'watch-inline' | 'watch-overlay'
  | 'dock-primary' | 'dock-quiet' | 'dock-tool' | 'dock-dropdown'
  | 'settings-choice' | 'settings-group' | 'settings-pill' | 'settings-preview' | 'icon-shell' | 'icon-immersive' | 'icon-watch' | 'icon-feed' | 'icon-search' | 'modal-close' | 'immersive-action' | 'section-row' | 'feed-search-action' | 'feed-inline' | 'feed-card-action' | 'compete-primary' | 'record-action' | 'compete-result-row' | 'pip-close' | 'move-play';

export type SelectVariant = 'dock-mode' | 'dock-source' | 'settings' | 'settings-extra' | 'plain';
export type InputVariant = 'search' | 'settings' | 'panel' | 'plain';
export type CheckboxVariant = 'menu' | 'settings';

const buttonClass = (variant: ButtonVariant, className = '') =>
  `ui-btn ui-btn--${variant}${className ? ` ${className}` : ''}`;

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & {variant?: ButtonVariant}>(
  function Button({variant = 'plain', className = '', type = 'button', ...props}, ref) {
    return <button {...props} ref={ref} type={type} className={buttonClass(variant, className)}/>;
  });

export const IconButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'icon-shell' | 'icon-immersive' | 'icon-watch' | 'icon-feed' | 'icon-search' | 'modal-close';
}>(function IconButton({variant = 'icon-shell', className = '', type = 'button', ...props}, ref) {
  return <button {...props} ref={ref} type={type} className={buttonClass(variant, `ui-icon-button ${className}`)}/>;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & {variant?: SelectVariant}>(
  function Select({variant = 'plain', className = '', ...props}, ref) {
    return <select {...props} ref={ref} className={`ui-select ui-select--${variant}${className ? ` ${className}` : ''}`}/>;
  });

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & {variant?: InputVariant}>(
  function Input({variant = 'plain', className = '', ...props}, ref) {
    return <input {...props} ref={ref} className={`ui-input ui-input--${variant}${className ? ` ${className}` : ''}`}/>;
  });

export const Checkbox = forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {variant?: CheckboxVariant}>(
  function Checkbox({variant = 'settings', className = '', ...props}, ref) {
    return <input {...props} ref={ref} type="checkbox" className={`ui-checkbox ui-checkbox--${variant}${className ? ` ${className}` : ''}`}/>;
  });

export const MenuTrigger = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & {variant?: ButtonVariant}>(
  function MenuTrigger({variant = 'dock-dropdown', className = '', type = 'button', ...props}, ref) {
    return <Button {...props} ref={ref} type={type} variant={variant} aria-haspopup={props['aria-haspopup'] ?? 'menu'}
      className={`ui-menu-trigger ${className}`}/>;
  });
