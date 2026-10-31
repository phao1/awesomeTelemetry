import { createContext, useContext, type ReactNode } from 'react';
import type { Locale } from '../../i18n.js';
const UiLocale=createContext<Locale|null>(null);
export function UiLocaleProvider({locale,children}:{locale:Locale;children:ReactNode}):React.JSX.Element{return <UiLocale.Provider value={locale}>{children}</UiLocale.Provider>;}
export function useUiLocale(locale?:Locale):Locale { const context=useContext(UiLocale);return locale??context??(document.documentElement.lang.startsWith('en')?'en':'zh'); }
