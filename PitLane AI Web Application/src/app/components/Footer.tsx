import { Twitter, Github, Linkedin, Mail } from 'lucide-react';

export function Footer() {
  const footerLinks = {
    Product: ['Features', 'Pricing', 'How It Works', 'Roadmap', 'Changelog'],
    Company: ['About', 'Blog', 'Careers', 'Press Kit', 'Contact'],
    Resources: ['Documentation', 'API Reference', 'Guides', 'Support', 'Status'],
    Legal: ['Privacy Policy', 'Terms of Service', 'Cookie Policy', 'GDPR'],
  };

  return (
    <footer
      className="border-t py-16 px-6"
      style={{
        backgroundColor: 'var(--bg-surface)',
        borderColor: 'var(--border-subtle)',
      }}
    >
      <div className="max-w-[1400px] mx-auto">
        {/* Top Section */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-12 mb-12">
          {/* Brand Column */}
          <div className="lg:col-span-2">
            <div className="flex items-center gap-2 mb-4">
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
            <p className="text-sm mb-6 max-w-xs" style={{ color: 'var(--text-secondary)' }}>
              AI-powered race coaching for every driver. Built at the Voxel51 Hackathon 2026.
            </p>
            <div className="flex items-center gap-4">
              <a
                href="#"
                className="w-9 h-9 rounded-lg flex items-center justify-center transition-colors hover:bg-[var(--accent-green-glow)]"
                style={{ backgroundColor: 'var(--bg-elevated)' }}
              >
                <Twitter size={18} strokeWidth={1.5} style={{ color: 'var(--text-secondary)' }} />
              </a>
              <a
                href="#"
                className="w-9 h-9 rounded-lg flex items-center justify-center transition-colors hover:bg-[var(--accent-green-glow)]"
                style={{ backgroundColor: 'var(--bg-elevated)' }}
              >
                <Github size={18} strokeWidth={1.5} style={{ color: 'var(--text-secondary)' }} />
              </a>
              <a
                href="#"
                className="w-9 h-9 rounded-lg flex items-center justify-center transition-colors hover:bg-[var(--accent-green-glow)]"
                style={{ backgroundColor: 'var(--bg-elevated)' }}
              >
                <Linkedin size={18} strokeWidth={1.5} style={{ color: 'var(--text-secondary)' }} />
              </a>
              <a
                href="#"
                className="w-9 h-9 rounded-lg flex items-center justify-center transition-colors hover:bg-[var(--accent-green-glow)]"
                style={{ backgroundColor: 'var(--bg-elevated)' }}
              >
                <Mail size={18} strokeWidth={1.5} style={{ color: 'var(--text-secondary)' }} />
              </a>
            </div>
          </div>

          {/* Links Columns */}
          {Object.entries(footerLinks).map(([category, links]) => (
            <div key={category}>
              <h4 className="text-white font-semibold mb-4 text-sm">{category}</h4>
              <ul className="space-y-3">
                {links.map((link) => (
                  <li key={link}>
                    <a
                      href="#"
                      className="text-sm transition-colors hover:text-white"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      {link}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Bottom Section */}
        <div
          className="pt-8 border-t flex flex-col md:flex-row items-center justify-between gap-4"
          style={{ borderColor: 'var(--border-subtle)' }}
        >
          <div className="text-sm" style={{ color: 'var(--text-muted)' }}>
            © 2026 ApexAI. All rights reserved.
          </div>
          <div className="flex items-center gap-6 text-sm">
            <span style={{ color: 'var(--text-muted)' }}>Built with</span>
            <div className="flex items-center gap-3">
              <span className="font-semibold" style={{ color: 'var(--text-secondary)' }}>
                Twelve Labs
              </span>
              <div className="w-px h-3 bg-[var(--border-subtle)]"></div>
              <span className="font-semibold" style={{ color: 'var(--text-secondary)' }}>
                Voxel51
              </span>
              <div className="w-px h-3 bg-[var(--border-subtle)]"></div>
              <span className="font-semibold" style={{ color: 'var(--text-secondary)' }}>
                FiftyOne
              </span>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
