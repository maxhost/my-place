import { describe, expect, it } from "vitest";
import { deepMerge } from "../deep-merge";

// Tests del util `deepMerge` — fallback runtime de i18n (ADR-0024). Garantiza
// que un catálogo de traducción parcial (`{locale}.json`) preserve las keys
// del catálogo base (`defaultLocale.json`) recursivamente. UX nunca renderea
// una key cruda por ausencia de traducción.

describe("deepMerge — merge profundo con override preservando base", () => {
  it("merge plano: override añade key sin tocar las del base", () => {
    expect(deepMerge({ a: 1 }, { b: 2 })).toEqual({ a: 1, b: 2 });
  });

  it("override reemplaza el valor de una key existente en base", () => {
    expect(deepMerge({ a: 1 }, { a: 2 })).toEqual({ a: 2 });
  });

  it("merge anidado: override sobre subkey preserva el resto del subtree", () => {
    const base = { common: { save: "Guardar", cancel: "Cancelar" } };
    const override = { common: { save: "Save" } };
    expect(deepMerge(base, override)).toEqual({
      common: { save: "Save", cancel: "Cancelar" },
    });
  });

  it("merge anidado profundo: override 3 niveles preserva ramas vecinas", () => {
    const base = {
      a: { b: { c: "x", d: "y" }, e: "z" },
      f: "g",
    };
    const override = { a: { b: { c: "X" } } };
    expect(deepMerge(base, override)).toEqual({
      a: { b: { c: "X", d: "y" }, e: "z" },
      f: "g",
    });
  });

  it("override con namespace que el base no tiene → se incluye en el resultado", () => {
    const base = { common: { save: "Guardar" } };
    const override = { extra: { foo: "bar" } };
    expect(deepMerge(base, override)).toEqual({
      common: { save: "Guardar" },
      extra: { foo: "bar" },
    });
  });

  it("ambos vacíos → {}", () => {
    expect(deepMerge({}, {})).toEqual({});
  });

  it("base vacío → devuelve override (clone, no la misma referencia)", () => {
    const override = { a: 1 };
    const result = deepMerge({}, override);
    expect(result).toEqual({ a: 1 });
    expect(result).not.toBe(override);
  });

  it("override vacío → devuelve base (clone, no la misma referencia)", () => {
    const base = { a: 1 };
    const result = deepMerge(base, {});
    expect(result).toEqual({ a: 1 });
    expect(result).not.toBe(base);
  });

  it("arrays → override reemplaza enteramente (no concatena)", () => {
    expect(deepMerge({ list: [1, 2] }, { list: [3] })).toEqual({ list: [3] });
  });

  it("colisión tipo: objeto del base vs string del override → override gana", () => {
    expect(deepMerge({ x: { nested: true } }, { x: "leaf" })).toEqual({
      x: "leaf",
    });
  });

  it("colisión tipo: string del base vs objeto del override → override gana", () => {
    expect(deepMerge({ x: "leaf" }, { x: { nested: true } })).toEqual({
      x: { nested: true },
    });
  });

  it("no muta los objetos de entrada (immutability)", () => {
    const base = { a: { b: 1 } };
    const override = { a: { c: 2 } };
    deepMerge(base, override);
    expect(base).toEqual({ a: { b: 1 } });
    expect(override).toEqual({ a: { c: 2 } });
  });

  it("merge anidado no comparte referencia con el subtree del base (clone profundo donde merge)", () => {
    const baseSubtree = { x: 1 };
    const base = { wrap: baseSubtree };
    const override = { wrap: { y: 2 } };
    const result = deepMerge(base, override) as { wrap: Record<string, unknown> };
    expect(result.wrap).toEqual({ x: 1, y: 2 });
    expect(result.wrap).not.toBe(baseSubtree);
  });
});
