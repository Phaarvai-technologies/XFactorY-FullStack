"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FlowHeader, Progress } from "@/components/visionary/FlowChrome";
import { errorMessage, useVisionaryApi } from "@/lib/visionary/api";
import { VISIONARY_OVERVIEW_PATH, type VisionarySlide } from "@/lib/visionary/paths";
import type { VisionaryProfile } from "@/lib/visionary/storage";
import { getVisionaryData } from "@/lib/visionary/store";

const EMPTY: VisionaryProfile = {
  name: "",
  role: "",
  org: "",
  location: "",
  intro: "",
};

const ROLES = ["Entrepreneur", "Product designer", "Engineer", "Inventor", "Student", "Investor"];

export function StepProfile({
  onContinue,
  onToast,
}: {
  onContinue: (slide: VisionarySlide) => void;
  onToast: (message: string) => void;
}) {
  const router = useRouter();
  const visionaryApi = useVisionaryApi();
  const [profile, setProfile] = useState<VisionaryProfile>(() => ({
    ...EMPTY,
    ...(getVisionaryData().profile ?? {}),
  }));
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);

  function update(key: keyof VisionaryProfile, value: string) {
    setProfile((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: false }));
  }

  /** PUT /visionary/profile. */
  function save() {
    return visionaryApi.saveProfile({
      name: profile.name.trim(),
      role: profile.role.trim(),
      org: profile.org.trim(),
      location: profile.location.trim(),
      intro: profile.intro.trim(),
    });
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    const nextErrors = {
      name: !profile.name.trim(),
      role: !profile.role.trim(),
      location: !profile.location.trim(),
    };
    setErrors(nextErrors);
    if (nextErrors.name || nextErrors.role || nextErrors.location) {
      const first = nextErrors.name ? "name" : nextErrors.role ? "role" : "location";
      document.getElementById(first)?.focus();
      return;
    }
    setSaving(true);
    try {
      await save();
      onContinue("step2");
    } catch (error) {
      onToast(errorMessage(error, "Couldn’t save your details. Please try again."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="view active" id="v-s1">
      <FlowHeader />
      <main>
        <section className="side">
          <h1>Let’s Start With You</h1>
          <p>Tell us a little about yourself so we can understand your project journey.</p>
          <div className="note">
            Takes about a minute. You can edit these details later from your profile.
          </div>
        </section>
        <section>
          <Progress label="Your details" step={1} />
          <form className="card" noValidate onSubmit={submit}>
            <div className="row">
              <div className={`field${errors.name ? " error" : ""}`} data-f="name">
                <label htmlFor="name">Full name</label>
                <p className="hint">The name collaborators will see.</p>
                <input
                  id="name"
                  name="name"
                  autoComplete="name"
                  placeholder="e.g. Priya"
                  required
                  value={profile.name}
                  onChange={(event) => update("name", event.target.value)}
                />
                <p className="err">Please enter your full name.</p>
              </div>
              <div className={`field${errors.role ? " error" : ""}`} data-f="role">
                <label htmlFor="role">What do you do?</label>
                <p className="hint">Your role or profession.</p>
                <input
                  id="role"
                  name="role"
                  list="roles"
                  placeholder="e.g. Entrepreneur"
                  required
                  value={profile.role}
                  onChange={(event) => update("role", event.target.value)}
                />
                <datalist id="roles">
                  {ROLES.map((role) => (
                    <option key={role} value={role} />
                  ))}
                </datalist>
                <p className="err">Tell us what you do.</p>
              </div>
            </div>
            <div className="row">
              <div className="field" data-f="org">
                <label htmlFor="org">
                  Company / Organization <span className="opt">Optional</span>
                </label>
                <p className="hint">Leave blank if you’re starting on your own.</p>
                <input
                  id="org"
                  name="org"
                  autoComplete="organization"
                  placeholder="e.g. Kaveri Home Goods"
                  value={profile.org}
                  onChange={(event) => update("org", event.target.value)}
                />
              </div>
              <div className={`field${errors.location ? " error" : ""}`} data-f="location">
                <label htmlFor="location">Location</label>
                <p className="hint">City where you’re based.</p>
                <input
                  id="location"
                  name="location"
                  autoComplete="address-level2"
                  placeholder="e.g. Chennai"
                  required
                  value={profile.location}
                  onChange={(event) => update("location", event.target.value)}
                />
                <p className="err">Please enter your city.</p>
              </div>
            </div>
            <div className="field" data-f="intro">
              <label htmlFor="intro">Short introduction</label>
              <p className="hint">A line or two about you and what you want to build.</p>
              <textarea
                id="intro"
                name="intro"
                maxLength={300}
                placeholder="Tell us a little about yourself"
                value={profile.intro}
                onChange={(event) => update("intro", event.target.value)}
              />
              <div className="count">
                <span>{profile.intro.length}</span>/300
              </div>
            </div>
            <div className="actions">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  // Keeps what was typed when the required fields are filled (the server
                  // stores complete profiles only), then leaves the flow as before.
                  const complete = profile.name.trim() && profile.role.trim() && profile.location.trim();
                  if (complete) void save().catch(() => undefined);
                  router.push(VISIONARY_OVERVIEW_PATH);
                }}
              >
                Previous
              </button>
              <button type="submit" className="btn btn-primary" aria-busy={saving}>
                Continue
              </button>
            </div>
          </form>
        </section>
      </main>
    </div>
  );
}
