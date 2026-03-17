import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// import { StaticPrototype } from './prototype/StaticPrototype';

// ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
//   <React.StrictMode>
//     <StaticPrototype />
//   </React.StrictMode>
// );