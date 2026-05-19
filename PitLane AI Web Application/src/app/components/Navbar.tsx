import { useState, useEffect } from 'react';
import { Menu, X } from 'lucide-react';

export function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled ? 'backdrop-blur-lg bg-[var(--bg-primary)]/90' : 'bg-transparent'
      }`}
      style={{ borderBottom: scrolled ? '1px solid var(--border-subtle)' : 'none' }}
    >
      <div className="max-w-[1400px] mx-auto px-6 h-16 flex items-center justify-between">
        {/* Logo */}
        <div className="flex items-center gap-2">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-[var(--accent-green)]">
            <path
              d="M2 14C2 14 4 8 8 8C12 8 14 2 14 2"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
          </svg>
          <span className="text-white font-semibold text-lg">ApexAI</span>
        </div>

        {/* Desktop Nav Links */}
        <div className="hidden md:flex items-center gap-8 text-sm">
          <a href="#features" className="text-[var(--text-secondary)] hover:text-white transition-colors">
            Features
          </a>
          <a href="#how-it-works" className="text-[var(--text-secondary)] hover:text-white transition-colors">
            How It Works
          </a>
          <a href="#pricing" className="text-[var(--text-secondary)] hover:text-white transition-colors">
            Pricing
          </a>
          <a href="#docs" className="text-[var(--text-secondary)] hover:text-white transition-colors">
            Docs
          </a>
        </div>

        {/* Desktop CTA Buttons */}
        <div className="hidden md:flex items-center gap-3">
          <button className="text-[var(--text-secondary)] hover:text-white transition-colors px-4 py-2 text-sm font-semibold">
            Sign in
          </button>
          <button
            className="bg-[var(--accent-green)] text-black px-4 py-2 rounded-md text-sm font-semibold hover:bg-[var(--accent-green-dim)] transition-colors"
            style={{ height: '36px' }}
          >
            Start Free
          </button>
        </div>

        {/* Mobile Menu Button */}
        <button
          className="md:hidden text-white"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
        >
          {mobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>

      {/* Mobile Menu */}
      {mobileMenuOpen && (
        <div className="md:hidden bg-[var(--bg-surface)] border-t border-[var(--border-subtle)]">
          <div className="flex flex-col px-6 py-4 gap-4">
            <a href="#features" className="text-[var(--text-secondary)] hover:text-white transition-colors py-2">
              Features
            </a>
            <a href="#how-it-works" className="text-[var(--text-secondary)] hover:text-white transition-colors py-2">
              How It Works
            </a>
            <a href="#pricing" className="text-[var(--text-secondary)] hover:text-white transition-colors py-2">
              Pricing
            </a>
            <a href="#docs" className="text-[var(--text-secondary)] hover:text-white transition-colors py-2">
              Docs
            </a>
            <div className="border-t border-[var(--border-subtle)] pt-4 flex flex-col gap-3">
              <button className="text-[var(--text-secondary)] hover:text-white transition-colors text-left py-2 font-semibold">
                Sign in
              </button>
              <button className="bg-[var(--accent-green)] text-black px-4 py-2 rounded-md font-semibold hover:bg-[var(--accent-green-dim)] transition-colors">
                Start Free
              </button>
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}
