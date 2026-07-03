import { useEffect, useState } from "react";

export default function AboutModal({ onClose }: { onClose: () => void }) {
  const [version, setVersion] = useState<string>("");

  useEffect(() => {
    window.api.app?.version().then(setVersion).catch(() => {});
  }, []);

  return (
    <div className="overlay" onClick={onClose}>
      <div
        className="settings-modal about-modal"
        style={{ position: "relative" }}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="modal-close" onClick={onClose}>×</button>
        <h2>Tasks Desktop</h2>
        <div className="about-version">{version ? `Version ${version}` : "Version unknown"}</div>
        <div className="about-license">
          <p>Copyright © 2026 Arlis</p>
          <p>
            This program is free software: you can redistribute it and/or modify it
            under the terms of the GNU General Public License as published by the
            Free Software Foundation, either version 3 of the License, or (at your
            option) any later version.
          </p>
          <p>
            This program is distributed in the hope that it will be useful, but
            WITHOUT ANY WARRANTY; without even the implied warranty of
            MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
            General Public License for more details.
          </p>
          <p>
            Full license text:{" "}
            <a href="https://www.gnu.org/licenses/gpl-3.0.html" target="_blank" rel="noreferrer">
              gnu.org/licenses/gpl-3.0
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
