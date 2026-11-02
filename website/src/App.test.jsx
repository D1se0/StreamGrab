import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../src/App.jsx';

describe('StreamGrab landing page', () => {
  it('renders the hero with headline and version pill in English by default', () => {
    render(<App />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('one clean MP4');
    expect(screen.getByTestId('hero-pill')).toHaveTextContent('v1.1.0');
    expect(screen.getByTestId('hero-pill')).toHaveTextContent('100% local');
  });

  it('shows install steps for both browser families', () => {
    render(<App />);
    expect(screen.getByTestId('steps-chrome').children.length).toBeGreaterThanOrEqual(4);
    expect(screen.getByTestId('steps-firefox').children.length).toBeGreaterThanOrEqual(3);
    expect(screen.getByTestId('steps-chrome')).toHaveTextContent(/chrome:\/\//i);
    expect(screen.getByTestId('steps-firefox')).toHaveTextContent(/about:debugging/i);
  });

  it('links to the GitHub repository and to releases', () => {
    render(<App />);
    const links = Array.from(document.querySelectorAll('a[href]')).map((a) => a.href);
    expect(links.some((h) => h.includes('github.com/D1se0/StreamGrab/releases'))).toBe(true);
    expect(links.some((h) => h === 'https://github.com/D1se0/StreamGrab')).toBe(true);
  });

  it('toggles the whole page to Spanish, including hero and FAQ', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: /idioma|language/i }));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('un MP4 limpio');
    expect(screen.getByTestId('hero-pill')).toHaveTextContent('gratis');
    const faqQ = screen.getAllByText(/DRM/)[0];
    expect(faqQ).toBeTruthy();
    expect(document.documentElement.querySelectorAll('details.faq-item').length).toBe(5);
  });
});
