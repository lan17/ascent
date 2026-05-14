import * as THREE from "three";

export type Laser = {
  id: number;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  hostile: boolean;
  active: boolean;
};

export type Robot = {
  id: number;
  pos: THREE.Vector3;
  hp: number;
  fireCooldown: number;
  bobPhase: number;
  alive: boolean;
  mode: "patrol" | "chase";
  targetCell: [number, number, number] | null;
  lastCell: [number, number, number] | null;
  aiTimer: number;
  cellOffset: THREE.Vector3;
  strafeTimer: number;
};

export type GameState = {
  status: "menu" | "playing" | "dead" | "won";
  health: number;
  shields: number;
  score: number;
  enemiesLeft: number;
  reactorAlive: boolean;
  message: string;
};

export const initialState: GameState = {
  status: "menu",
  health: 100,
  shields: 100,
  score: 0,
  enemiesLeft: 0,
  reactorAlive: true,
  message: "",
};
