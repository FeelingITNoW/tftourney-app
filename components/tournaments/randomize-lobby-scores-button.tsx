"use client";

type RandomizeLobbyScoresButtonProps = {
  disabled: boolean;
};

// Temporary QA helper: fill every placement with a unique random value and
// submit through the normal lobby-results action.
export function RandomizeLobbyScoresButton({
  disabled,
}: RandomizeLobbyScoresButtonProps) {
  function randomizeAndSave(event: React.MouseEvent<HTMLButtonElement>) {
    const form = event.currentTarget.form;

    if (!form) {
      return;
    }

    const placementInputs = Array.from(form.elements).filter(
      (element): element is HTMLInputElement =>
        element instanceof HTMLInputElement && element.name === "placement",
    );
    const placements = placementInputs.map((_, index) => index + 1);

    for (let index = placements.length - 1; index > 0; index -= 1) {
      const randomIndex = Math.floor(Math.random() * (index + 1));
      [placements[index], placements[randomIndex]] = [
        placements[randomIndex],
        placements[index],
      ];
    }

    placementInputs.forEach((input, index) => {
      input.value = String(placements[index]);
    });
    form.requestSubmit();
  }

  return (
    <button
      className="flex h-11 items-center justify-center rounded-md border border-amber-300 bg-amber-50 px-4 text-sm font-semibold text-amber-900 transition hover:bg-amber-100 focus:outline-none focus:ring-2 focus:ring-amber-600 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40"
      disabled={disabled}
      onClick={randomizeAndSave}
      title="Temporary testing helper"
      type="button"
    >
      Randomize &amp; save test scores
    </button>
  );
}
