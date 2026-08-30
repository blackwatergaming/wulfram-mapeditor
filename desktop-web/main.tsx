import React from 'react';
import { createRoot } from 'react-dom/client';

import '@/app/globals.css';
import { EditorApp } from '@/components/editor/editor-app';

const root = document.getElementById('root');
if (!root) throw new Error('Desktop editor root is missing.');
createRoot(root).render(<EditorApp />);
