import { startTransition, type FormEvent } from "react";

/*
 * React clears uncontrolled form fields after every `<form action>` submit,
 * including rejected saves. Submitting through onSubmit keeps the author's
 * typing on screen when a save is refused.
 */
export function submitWithoutReset(dispatch: (formData: FormData) => void) {
  return (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => dispatch(formData));
  };
}
