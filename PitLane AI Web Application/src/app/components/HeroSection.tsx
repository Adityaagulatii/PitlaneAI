import { Play, ArrowRight } from 'lucide-react';

export function HeroSection({ onAnalyzeClick }: { onAnalyzeClick?: () => void }) {
  return (
    <section className="pt-32 pb-20 px-6">
      <div className="max-w-[1400px] mx-auto">
        {/* Eyebrow Badge */}
        <div className="flex justify-center mb-6">
          <div
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full border text-sm"
            style={{
              borderColor: 'var(--accent-green)',
              backgroundColor: 'var(--accent-green-glow)',
              color: 'var(--accent-green)',
            }}
          >
            <span>🏁</span>
            <span>Built at Voxel51 Hackathon · April 2026</span>
          </div>
        </div>

        {/* Hero Heading */}
        <div className="text-center max-w-[900px] mx-auto">
          <h1 className="text-5xl md:text-7xl font-extrabold leading-tight mb-6">
            <span className="text-white">Your AI race engineer.</span>
            <br />
            <span style={{ color: 'var(--accent-green)' }}>For every driver.</span>
          </h1>

          <p
            className="text-lg md:text-xl max-w-[560px] mx-auto mb-10"
            style={{ color: 'var(--text-secondary)' }}
          >
            Upload your onboard lap video. ApexAI finds your mistakes, highlights your best moments, and tells you
            exactly how to go faster — in plain English.
          </p>

          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-12">
            <button
              onClick={onAnalyzeClick}
              className="flex items-center gap-2 px-6 py-3 rounded-lg text-black font-semibold text-base transition-all hover:shadow-[var(--shadow-glow-green)]"
              style={{
                backgroundColor: 'var(--accent-green)',
                height: '48px',
              }}
            >
              <span>Analyze My Lap</span>
              <ArrowRight size={20} strokeWidth={2} />
            </button>
            <button
              className="flex items-center gap-2 px-6 py-3 rounded-lg font-semibold text-base transition-colors border"
              style={{
                borderColor: 'var(--text-primary)',
                color: 'var(--text-primary)',
                height: '48px',
              }}
            >
              <Play size={18} strokeWidth={2} />
              <span>Watch Demo</span>
            </button>
          </div>

          {/* Social Proof */}
          <div className="flex flex-wrap items-center justify-center gap-3 text-xs" style={{ color: 'var(--text-muted)' }}>
            <span>Powered by</span>
            <div className="flex items-center gap-3">
              <span className="font-semibold text-white">Twelve Labs</span>
              <div className="w-px h-3 bg-[var(--border-subtle)]"></div>
              <span className="font-semibold text-white">Voxel51 / FiftyOne</span>
              <div className="w-px h-3 bg-[var(--border-subtle)]"></div>
              <span className="font-semibold text-white">Northeastern 2026</span>
            </div>
          </div>
        </div>

        {/* Hero Visual - Product Screenshot Mockup */}
        <div className="mt-16 max-w-[1200px] mx-auto">
          <div
            className="rounded-2xl border p-1 relative"
            style={{
              borderColor: 'var(--border-subtle)',
              backgroundColor: 'var(--bg-surface)',
              boxShadow: '0 20px 60px rgba(0, 255, 135, 0.1)',
            }}
          >
            {/* Window Controls */}
            <div className="flex items-center gap-2 px-4 py-3 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
              <div className="w-3 h-3 rounded-full bg-[#FF5F57]"></div>
              <div className="w-3 h-3 rounded-full bg-[#FFBD2E]"></div>
              <div className="w-3 h-3 rounded-full bg-[#28C840]"></div>
            </div>

            {/* App Content Area */}
            <div className="flex" style={{ backgroundColor: 'var(--bg-card)' }}>
              {/* Sidebar */}
              <div
                className="w-14 border-r flex flex-col items-center py-4 gap-4"
                style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--bg-surface)' }}
              >
                <div className="w-8 h-8 rounded-lg bg-[var(--accent-green-glow)] flex items-center justify-center">
                  <div className="w-4 h-4 bg-[var(--accent-green)] rounded"></div>
                </div>
                <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'var(--bg-elevated)' }}>
                  <div className="w-4 h-4 bg-[var(--text-muted)] rounded"></div>
                </div>
                <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'var(--bg-elevated)' }}>
                  <div className="w-4 h-4 bg-[var(--text-muted)] rounded"></div>
                </div>
              </div>

              {/* Main Content */}
              <div className="flex-1 p-6">
                {/* Video Player Mockup */}
                <div className="rounded-lg overflow-hidden mb-4" style={{ backgroundColor: '#000' }}>
                  <div className="aspect-video bg-gradient-to-br from-gray-800 to-gray-900 flex items-center justify-center relative">
                    <div className="absolute inset-0 opacity-20">
                      <div className="w-full h-full grid grid-cols-8 grid-rows-6">
                        {[...Array(48)].map((_, i) => (
                          <div key={i} className="border border-gray-700"></div>
                        ))}
                      </div>
                    </div>
                    <div className="relative z-10 text-white/40 text-sm font-medium">Onboard Camera View</div>
                  </div>
                </div>

                {/* Timeline with Colored Segments */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2 h-12 rounded-lg overflow-hidden" style={{ backgroundColor: 'var(--bg-surface)' }}>
                    <div className="h-full bg-gray-600" style={{ width: '8%' }}></div>
                    <div className="h-full bg-[var(--accent-red)]" style={{ width: '12%' }}></div>
                    <div className="h-full bg-gray-600" style={{ width: '15%' }}></div>
                    <div
                      className="h-full relative"
                      style={{
                        width: '18%',
                        backgroundColor: 'var(--accent-green)',
                        boxShadow: 'var(--shadow-glow-green)',
                      }}
                    >
                      <div className="absolute inset-0 border-2 border-white/30"></div>
                    </div>
                    <div className="h-full bg-gray-600" style={{ width: '10%' }}></div>
                    <div className="h-full bg-[var(--accent-yellow)]" style={{ width: '14%' }}></div>
                    <div className="h-full bg-gray-600" style={{ width: '8%' }}></div>
                    <div className="h-full bg-[var(--accent-red)]" style={{ width: '15%' }}></div>
                  </div>
                </div>
              </div>

              {/* Right Panel - AI Response */}
              <div
                className="w-80 border-l p-6 space-y-4"
                style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--bg-surface)' }}
              >
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-[var(--accent-green)] animate-pulse"></div>
                  <span className="text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>
                    AI Analysis
                  </span>
                </div>
                <div className="space-y-2">
                  <div className="h-3 bg-[var(--bg-elevated)] rounded" style={{ width: '100%' }}></div>
                  <div className="h-3 bg-[var(--bg-elevated)] rounded" style={{ width: '90%' }}></div>
                  <div className="h-3 bg-[var(--bg-elevated)] rounded" style={{ width: '95%' }}></div>
                  <div className="h-3 bg-[var(--bg-elevated)] rounded" style={{ width: '85%' }}></div>
                  <div className="h-3 bg-[var(--bg-elevated)] rounded mt-4" style={{ width: '100%' }}></div>
                  <div className="h-3 bg-[var(--bg-elevated)] rounded" style={{ width: '75%' }}></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
