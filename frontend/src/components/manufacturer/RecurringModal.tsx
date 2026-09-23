import { useState } from "react";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

type RecurringModalProps = {
  onSave: (days: string[], start: string, end: string) => void;
  onClose: () => void;
};

export function RecurringModal({ onSave, onClose }: RecurringModalProps) {
  const [days, setDays] = useState<string[]>([]);
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");

  function toggleDay(day: string) {
    setDays((current) =>
      current.includes(day) ? current.filter((d) => d !== day) : [...current, day],
    );
  }

  function handleSave() {
    onSave(days, startTime, endTime);
  }

  return (
    <div className="modal-backdrop show">
      <div className="modal-card">
        <h3>Add recurring availability</h3>
        <label>Days of the week</label>
        <div className="pill-group">
          {DAYS.map((day) => (
            <button
              key={day}
              type="button"
              className={`pill-option${days.includes(day) ? " active" : ""}`}
              onClick={() => toggleDay(day)}
            >
              {day}
            </button>
          ))}
        </div>
        <div className="form-grid" style={{ marginTop: 16 }}>
          <div>
            <label htmlFor="rec-start-time">Start time</label>
            <input
              type="time"
              id="rec-start-time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="rec-end-time">End time</label>
            <input
              type="time"
              id="rec-end-time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
            />
          </div>
        </div>
        <div className="modal-actions">
          <button className="btn-secondary-full" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" type="button" onClick={handleSave}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
