import { useState } from 'react';
import { Navbar } from './components/Navbar';
import { HeroSection } from './components/HeroSection';
import { FeatureStrip } from './components/FeatureStrip';
import { FeaturesSection } from './components/FeaturesSection';
import { HowItWorksSection } from './components/HowItWorksSection';
import { PricingSection } from './components/PricingSection';
import { TechStackSection } from './components/TechStackSection';
import { CTASection } from './components/CTASection';
import { Footer } from './components/Footer';
import { DemoPage } from './components/DemoPage';

export default function App() {
  return <DemoPage onBack={() => {}} />;
}
