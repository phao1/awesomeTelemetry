import { createRoot } from 'react-dom/client';

// REQ-001：顺序不可颠倒 — tokens → base → layout → components
import './styles/tokens.css';
import './styles/base.css';
import './styles/layout.css';
import './styles/components.css';

import App from './App';

const rootElement = document.getElementById('root');
if (rootElement === null) {
  throw new Error('#root element not found');
}

createRoot(rootElement).render(<App />);
