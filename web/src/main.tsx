import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

const raiz = document.getElementById('raiz');
if (!raiz) throw new Error('Elemento raiz não encontrado no documento.');

ReactDOM.createRoot(raiz).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
