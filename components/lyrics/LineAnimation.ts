import { Spring, PRESS_SPRING, RELEASE_SPRING } from "../../services/springSystem";

const ease = (value: number, target: number, dt: number, tau: number) => {
  const next = value + (target - value) * (1 - Math.exp(-dt / tau));
  return Math.abs(next - target) < 0.001 ? target : next;
};

export class LineAnimation {
  private until = 0;
  private hover = 0;
  private blur = 0;
  private opacity?: number;
  private readonly spring = new Spring(1);
  private readonly value = { hover: 0, press: 1, blur: 0, opacity: 1 };

  press(now = performance.now()) { this.until = now + 100; }

  update(dt: number, hovered: boolean, pressed: boolean, blur: number, opacity: number, now = performance.now()) {
    this.hover = ease(this.hover, hovered ? 1 : 0, dt, hovered ? 0.05 : 0.1);
    this.blur = ease(this.blur, blur, dt, blur > this.blur ? 0.12 : 0.18);
    this.opacity = this.opacity === undefined ? opacity : ease(this.opacity, opacity, dt, 0.16);
    const down = pressed || now < this.until;
    this.spring.set(down ? 0.95 : 1, down ? PRESS_SPRING : RELEASE_SPRING);
    this.spring.step(dt);
    this.value.hover = this.hover;
    this.value.press = this.spring.current;
    this.value.blur = this.blur * (1 - this.hover);
    this.value.opacity = this.opacity + (Math.max(0.8, this.opacity) - this.opacity) * this.hover;
    return this.value;
  }
}
