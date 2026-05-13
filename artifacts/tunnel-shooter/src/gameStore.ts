import * as THREE from "three";

export type Laser = {
  id: number;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  hostile: boolean;
};

export type Robot = {
  id: number;
  pos: THREE.Vector3;
  hp: number;
  fireCooldown: number;
  bobPhase: number;
  alive: boolean;
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
