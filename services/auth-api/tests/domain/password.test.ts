import { describe, it, expect } from "vitest";
import { PasswordPolicy } from "../../src/domain/password.policy";
import { WeakPasswordError } from "../../src/domain/types";

describe("Domain: Password Policy", () => {
  it("acepta contraseñas robustas que cumplen todos los requisitos", () => {
    const validPasswords = [
      "SiteCorp.2026#Secure",
      "SuperClave!987654",
      "AlphaOmega_2026$Enterprise",
    ];

    for (const pwd of validPasswords) {
      const result = PasswordPolicy.validate(pwd);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(() => PasswordPolicy.assertValid(pwd)).not.toThrow();
    }
  });

  it("rechaza contraseñas con longitud insuficiente (< 12 caracteres)", () => {
    const result = PasswordPolicy.validate("Short!1Aa");
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain("Debe tener al menos 12 caracteres");
  });

  it("rechaza contraseñas sin mayúsculas, minúsculas, números o caracteres especiales", () => {
    // Sin mayúscula
    const noUpper = PasswordPolicy.validate("sitecorp!2026password");
    expect(noUpper.isValid).toBe(false);
    expect(noUpper.errors).toContain("Debe contener al menos una letra mayúscula");

    // Sin minúscula
    const noLower = PasswordPolicy.validate("SITECORP!2026PASSWORD");
    expect(noLower.isValid).toBe(false);
    expect(noLower.errors).toContain("Debe contener al menos una letra minúscula");

    // Sin número
    const noNumber = PasswordPolicy.validate("SiteCorp!Enterprise");
    expect(noNumber.isValid).toBe(false);
    expect(noNumber.errors).toContain("Debe contener al menos un número");

    // Sin símbolo especial
    const noSpecial = PasswordPolicy.validate("SiteCorp2026Enterprise");
    expect(noSpecial.isValid).toBe(false);
    expect(noSpecial.errors).toContain("Debe contener al menos un carácter especial");
  });

  it("rechaza contraseñas comunes o predecibles", () => {
    const result = PasswordPolicy.validate("sitecorp2026!");
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain("La contraseña es demasiado predecible o vulnerable");
  });

  it("lanza WeakPasswordError con assertValid para contraseñas inválidas", () => {
    expect(() => PasswordPolicy.assertValid("123")).toThrow(WeakPasswordError);
  });
});
