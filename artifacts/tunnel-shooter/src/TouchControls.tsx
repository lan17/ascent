import { useEffect, useRef } from "react";

export type TouchInput = {
  active: boolean;
  lookX: number; lookY: number;
  moveX: number; moveY: number;
  firing: boolean;
};

type Props = {
  visible: boolean;
  autoFire: boolean;
  touch: TouchInput;
};

const STICK_RADIUS = 70;
const KNOB_RADIUS = 32;

type StickState = {
  pointerId: number | null;
  originX: number; originY: number;
  knobX: number; knobY: number;
  visible: boolean;
};

function newStick(): StickState {
  return { pointerId: null, originX: 0, originY: 0, knobX: 0, knobY: 0, visible: false };
}

export function TouchControls({ visible, autoFire, touch }: Props) {
  const leftZoneRef = useRef<HTMLDivElement>(null);
  const rightZoneRef = useRef<HTMLDivElement>(null);
  const leftBaseRef = useRef<HTMLDivElement>(null);
  const leftKnobRef = useRef<HTMLDivElement>(null);
  const rightBaseRef = useRef<HTMLDivElement>(null);
  const rightKnobRef = useRef<HTMLDivElement>(null);
  const fireBtnRef = useRef<HTMLButtonElement>(null);

  const leftStick = useRef<StickState>(newStick());
  const rightStick = useRef<StickState>(newStick());

  useEffect(() => {
    if (!visible) return;

    const updateVisual = (
      base: HTMLDivElement | null,
      knob: HTMLDivElement | null,
      st: StickState,
    ) => {
      if (!base || !knob) return;
      if (st.visible) {
        base.style.opacity = "1";
        base.style.transform = `translate(${st.originX - STICK_RADIUS}px, ${st.originY - STICK_RADIUS}px)`;
        knob.style.opacity = "1";
        knob.style.transform = `translate(${st.originX + st.knobX - KNOB_RADIUS}px, ${st.originY + st.knobY - KNOB_RADIUS}px)`;
      } else {
        base.style.opacity = "0";
        knob.style.opacity = "0";
      }
    };

    const setStickFromPointer = (
      st: StickState,
      cx: number, cy: number,
      writeLook: boolean,
    ) => {
      const dx = cx - st.originX;
      const dy = cy - st.originY;
      const len = Math.hypot(dx, dy);
      let kx = dx, ky = dy;
      if (len > STICK_RADIUS) {
        kx = (dx / len) * STICK_RADIUS;
        ky = (dy / len) * STICK_RADIUS;
      }
      st.knobX = kx;
      st.knobY = ky;
      const nx = kx / STICK_RADIUS;
      const ny = ky / STICK_RADIUS;
      if (writeLook) {
        touch.lookX = nx;
        touch.lookY = ny;
      } else {
        touch.moveX = nx;
        touch.moveY = ny;
      }
    };

    const attach = (
      zone: HTMLDivElement,
      st: StickState,
      base: HTMLDivElement | null,
      knob: HTMLDivElement | null,
      writeLook: boolean,
    ) => {
      const onDown = (e: PointerEvent) => {
        if (st.pointerId !== null) return;
        // Ignore touches that started on top of an interactive HUD button.
        const target = e.target as HTMLElement | null;
        if (target && target.closest("[data-touch-passthrough]")) return;
        st.pointerId = e.pointerId;
        st.originX = e.clientX;
        st.originY = e.clientY;
        st.knobX = 0; st.knobY = 0;
        st.visible = true;
        zone.setPointerCapture(e.pointerId);
        if (writeLook) { touch.lookX = 0; touch.lookY = 0; } else { touch.moveX = 0; touch.moveY = 0; }
        updateVisual(base, knob, st);
        e.preventDefault();
      };
      const onMove = (e: PointerEvent) => {
        if (e.pointerId !== st.pointerId) return;
        setStickFromPointer(st, e.clientX, e.clientY, writeLook);
        updateVisual(base, knob, st);
      };
      const onUp = (e: PointerEvent) => {
        if (e.pointerId !== st.pointerId) return;
        st.pointerId = null;
        st.visible = false;
        st.knobX = 0; st.knobY = 0;
        if (writeLook) { touch.lookX = 0; touch.lookY = 0; } else { touch.moveX = 0; touch.moveY = 0; }
        updateVisual(base, knob, st);
      };
      zone.addEventListener("pointerdown", onDown);
      zone.addEventListener("pointermove", onMove);
      zone.addEventListener("pointerup", onUp);
      zone.addEventListener("pointercancel", onUp);
      return () => {
        zone.removeEventListener("pointerdown", onDown);
        zone.removeEventListener("pointermove", onMove);
        zone.removeEventListener("pointerup", onUp);
        zone.removeEventListener("pointercancel", onUp);
      };
    };

    const lz = leftZoneRef.current;
    const rz = rightZoneRef.current;
    const cleanups: Array<() => void> = [];
    if (lz) cleanups.push(attach(lz, leftStick.current, leftBaseRef.current, leftKnobRef.current, false));
    if (rz) cleanups.push(attach(rz, rightStick.current, rightBaseRef.current, rightKnobRef.current, true));

    // Manual fire button (only meaningful when autoFire is off).
    const fb = fireBtnRef.current;
    const onFireDown = (e: PointerEvent) => { touch.firing = true; e.preventDefault(); };
    const onFireUp = (e: PointerEvent) => { touch.firing = false; e.preventDefault(); };
    if (fb) {
      fb.addEventListener("pointerdown", onFireDown);
      fb.addEventListener("pointerup", onFireUp);
      fb.addEventListener("pointercancel", onFireUp);
      fb.addEventListener("pointerleave", onFireUp);
    }

    touch.active = true;
    return () => {
      cleanups.forEach((c) => c());
      if (fb) {
        fb.removeEventListener("pointerdown", onFireDown);
        fb.removeEventListener("pointerup", onFireUp);
        fb.removeEventListener("pointercancel", onFireUp);
        fb.removeEventListener("pointerleave", onFireUp);
      }
      touch.active = false;
      touch.lookX = 0; touch.lookY = 0;
      touch.moveX = 0; touch.moveY = 0;
      touch.firing = false;
    };
  }, [visible, touch]);

  if (!visible) return null;

  return (
    <div
      className="pointer-events-none absolute inset-0 z-30 select-none"
      style={{ touchAction: "none", WebkitUserSelect: "none", userSelect: "none" }}
    >
      {/* Left stick zone (move) */}
      <div
        ref={leftZoneRef}
        className="pointer-events-auto absolute bottom-0 left-0 h-[70%] w-1/2"
        style={{ touchAction: "none" }}
      />
      {/* Right stick zone (look) */}
      <div
        ref={rightZoneRef}
        className="pointer-events-auto absolute bottom-0 right-0 h-[70%] w-1/2"
        style={{ touchAction: "none" }}
      />

      {/* Stick visuals (positioned via inline transform in JS) */}
      <div
        ref={leftBaseRef}
        className="pointer-events-none absolute left-0 top-0 rounded-full border-2 border-orange-300/40 bg-black/30 backdrop-blur-sm transition-opacity"
        style={{ width: STICK_RADIUS * 2, height: STICK_RADIUS * 2, opacity: 0 }}
      />
      <div
        ref={leftKnobRef}
        className="pointer-events-none absolute left-0 top-0 rounded-full border border-orange-200/70 bg-orange-400/40 transition-opacity"
        style={{ width: KNOB_RADIUS * 2, height: KNOB_RADIUS * 2, opacity: 0 }}
      />
      <div
        ref={rightBaseRef}
        className="pointer-events-none absolute left-0 top-0 rounded-full border-2 border-cyan-300/40 bg-black/30 backdrop-blur-sm transition-opacity"
        style={{ width: STICK_RADIUS * 2, height: STICK_RADIUS * 2, opacity: 0 }}
      />
      <div
        ref={rightKnobRef}
        className="pointer-events-none absolute left-0 top-0 rounded-full border border-cyan-200/70 bg-cyan-400/40 transition-opacity"
        style={{ width: KNOB_RADIUS * 2, height: KNOB_RADIUS * 2, opacity: 0 }}
      />

      {/* Hint labels */}
      <div className="pointer-events-none absolute bottom-3 left-3 text-[10px] uppercase tracking-widest text-orange-300/60">
        Move · Strafe
      </div>
      <div className="pointer-events-none absolute bottom-3 right-3 text-[10px] uppercase tracking-widest text-cyan-300/60">
        Look · Aim
      </div>

      {/* Manual fire button (shown only when autoFire is off) */}
      {!autoFire && (
        <button
          ref={fireBtnRef}
          data-touch-passthrough
          className="pointer-events-auto absolute bottom-28 right-6 z-40 h-20 w-20 rounded-full border-2 border-red-400/70 bg-red-500/30 text-xs font-bold uppercase tracking-widest text-red-100 backdrop-blur"
          style={{ touchAction: "none" }}
        >
          Fire
        </button>
      )}
    </div>
  );
}
