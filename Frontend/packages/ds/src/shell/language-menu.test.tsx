import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LanguageMenu } from "./language-menu";
import { renderWithIntl } from "../testing/intl";
import fr from "../messages/fr.json";

describe("LanguageMenu", () => {
  it("shows the current language and offers the three, each named in itself", async () => {
    const onChange = vi.fn();
    renderWithIntl(<LanguageMenu value="en" onChange={onChange} />);

    await userEvent.click(
      await screen.findByRole("button", { name: "Change language" })
    );
    expect(screen.getByText("العربية")).toHaveAttribute("lang", "ar");
    await userEvent.click(screen.getByText("Français"));

    expect(onChange).toHaveBeenCalledWith("fr");
  });

  it("does nothing when the current language is chosen again", async () => {
    const onChange = vi.fn();
    renderWithIntl(<LanguageMenu value="fr" onChange={onChange} />, {
      locale: "fr",
      messages: fr,
    });

    await userEvent.click(
      await screen.findByRole("button", { name: "Changer de langue" })
    );
    await userEvent.click(screen.getByText("Français"));

    expect(onChange).not.toHaveBeenCalled();
  });

  it("says a failed save at the top of the menu", async () => {
    renderWithIntl(<LanguageMenu value="en" onChange={vi.fn()} failed />);

    await userEvent.click(
      await screen.findByRole("button", { name: "Change language" })
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Couldn't save your language. Try again."
    );
  });
});
