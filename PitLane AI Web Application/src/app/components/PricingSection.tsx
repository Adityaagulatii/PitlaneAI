import { Check } from 'lucide-react';

export function PricingSection() {
  const plans = [
    {
      name: 'Free Trial',
      price: '$0',
      period: '3 laps',
      description: 'Try ApexAI risk-free',
      features: [
        'All 4 AI operators',
        'Video up to 10 minutes',
        'Full feature access',
        'Export highlights',
        'Basic coaching report',
      ],
      cta: 'Start Free',
      highlighted: false,
    },
    {
      name: 'Pro',
      price: '$29',
      period: 'per month',
      description: 'For serious drivers',
      features: [
        'Unlimited lap analysis',
        'Priority AI processing',
        'Advanced coaching reports',
        'Video up to 60 minutes',
        'Session comparison',
        'Export all data',
        'Priority support',
      ],
      cta: 'Start Pro',
      highlighted: true,
    },
    {
      name: 'Team',
      price: '$99',
      period: 'per month',
      description: 'For racing teams & coaches',
      features: [
        'Everything in Pro',
        'Up to 5 team members',
        'Shared lap library',
        'Driver comparison tools',
        'Custom branding on reports',
        'API access',
        'Dedicated support',
      ],
      cta: 'Contact Sales',
      highlighted: false,
    },
  ];

  return (
    <section id="pricing" className="py-20 px-6">
      <div className="max-w-[1200px] mx-auto">
        {/* Section Header */}
        <div className="text-center mb-16">
          <div className="text-xs font-semibold tracking-wider mb-4" style={{ color: 'var(--text-muted)' }}>
            PRICING
          </div>
          <h2 className="text-4xl md:text-5xl font-bold text-white mb-4">
            Simple pricing.<br />Start <span style={{ color: 'var(--accent-green)' }}>free</span>, upgrade when ready.
          </h2>
          <p className="text-lg max-w-[600px] mx-auto" style={{ color: 'var(--text-secondary)' }}>
            No credit card required for the free trial. Cancel anytime.
          </p>
        </div>

        {/* Pricing Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {plans.map((plan, index) => (
            <div
              key={index}
              className={`p-8 rounded-xl border transition-all duration-300 ${
                plan.highlighted ? 'scale-105 shadow-[var(--shadow-glow-green)]' : ''
              }`}
              style={{
                backgroundColor: plan.highlighted ? 'var(--bg-elevated)' : 'var(--bg-card)',
                borderColor: plan.highlighted ? 'var(--accent-green)' : 'var(--border-subtle)',
              }}
            >
              {/* Badge for highlighted plan */}
              {plan.highlighted && (
                <div
                  className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold mb-4"
                  style={{
                    backgroundColor: 'var(--accent-green-glow)',
                    color: 'var(--accent-green)',
                  }}
                >
                  Most Popular
                </div>
              )}

              {/* Plan Name */}
              <h3 className="text-xl font-bold text-white mb-2">{plan.name}</h3>
              <p className="text-sm mb-6" style={{ color: 'var(--text-secondary)' }}>
                {plan.description}
              </p>

              {/* Price */}
              <div className="mb-6">
                <span className="text-5xl font-extrabold text-white">{plan.price}</span>
                <span className="text-base ml-2" style={{ color: 'var(--text-secondary)' }}>
                  {plan.period}
                </span>
              </div>

              {/* CTA Button */}
              <button
                className={`w-full py-3 rounded-lg font-semibold transition-all mb-8 ${
                  plan.highlighted
                    ? 'bg-[var(--accent-green)] text-black hover:shadow-[var(--shadow-glow-green)]'
                    : 'bg-[var(--bg-surface)] text-white hover:bg-[var(--bg-elevated)] border border-[var(--border-subtle)]'
                }`}
              >
                {plan.cta}
              </button>

              {/* Features List */}
              <div className="space-y-3">
                {plan.features.map((feature, featureIndex) => (
                  <div key={featureIndex} className="flex items-start gap-3">
                    <Check
                      size={18}
                      strokeWidth={2.5}
                      className="mt-0.5 flex-shrink-0"
                      style={{ color: 'var(--accent-green)' }}
                    />
                    <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                      {feature}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Bottom Note */}
        <div className="text-center mt-12">
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            All plans include full access to our AI operators. Need custom enterprise solutions?{' '}
            <a href="#contact" className="underline" style={{ color: 'var(--accent-green)' }}>
              Contact us
            </a>
          </p>
        </div>
      </div>
    </section>
  );
}
