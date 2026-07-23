import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Without vitest's `globals: true`, Testing Library's auto-cleanup registration never
// fires, so each test's rendered DOM piles up in `document.body` across the file.
afterEach(cleanup);
