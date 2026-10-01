import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// globals kapalı olduğu için Testing Library otomatik temizlik yapmaz.
afterEach(() => {
  cleanup();
});
