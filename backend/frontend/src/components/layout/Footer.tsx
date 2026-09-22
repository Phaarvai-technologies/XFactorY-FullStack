import Link from "next/link";
import { FactoryMark } from "@/components/layout/Logo";

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="wrap">
        <div className="footer-top">
          <div className="footer-brand-block">
            <div className="footer-brand">
              <FactoryMark />
              X!Y
            </div>
            <p className="footer-desc">
              A discovery and engagement platform for the manufacturing ecosystem —
              connecting the people who design, make, supply and move physical
              products.
            </p>
          </div>
          <div className="footer-nav-cols">
            <div className="footer-col">
              <h4>Platform</h4>
              <ul>
                <li>
                  <Link href="/#personas">Personas</Link>
                </li>
                <li>
                  <Link href="/#how-it-works">How it works</Link>
                </li>
                <li>
                  <Link href="/#trust">Platform scope</Link>
                </li>
              </ul>
            </div>
            <div className="footer-col">
              <h4>Legal</h4>
              <ul>
                <li>
                  <a href="#privacy">Privacy policy</a>
                </li>
                <li>
                  <a href="#terms">Terms of service</a>
                </li>
              </ul>
            </div>
            <div className="footer-col">
              <h4>Support</h4>
              <ul>
                <li>
                  <Link href="/help">Help center</Link>
                </li>
                <li>
                  <a href="#contact">Contact us</a>
                </li>
              </ul>
            </div>
          </div>
        </div>
        <div className="footer-bottom">
          <div className="footer-copy">© 2026 X!Y. All rights reserved.</div>
          <div className="footer-pilot-badge">
            <span className="pilot-dot" /> Pilot status — limited regions
          </div>
        </div>
      </div>
    </footer>
  );
}
