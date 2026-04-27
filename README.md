# welcome to if

you're in.

`if` (impatient futurist) is a starter kit for personal automation tools — sveltekit + firebase + cloud functions + gemini, with everything provisioned in a single command.

## before you start

you should already have:

- a dedicated gmail account for this project
- a dedicated macos user account on the machine you'll work from
- google cloud free trial enabled on that gmail ([console.cloud.google.com/freetrial](https://console.cloud.google.com/freetrial))

if any of those are missing, do them now and come back.

## install

sign into your dedicated macos user, open `Terminal.app`, and run:

```sh
curl -fsSL https://almostawake.com/i.sh | bash
```

this will:
- install homebrew (asks for your sudo password once)
- install gh and sign you into github
- clone this repo to `~/.if/staging`
- install node, java, claude code, chrome with claude
- set up the **IF Terminal** preset

takes about 5 minutes. follow the prompts as they appear.

## create your first app

after install finishes, run:

```sh
bash ~/.if/staging/scripts/if-new.sh
```

this will:
- sign you into google cloud (browser flow)
- create (or reuse) a gcp project
- provision firebase, firestore, storage, auth, cloud functions, gemini api
- clone a fresh copy of the template into `~/projects/<your-project-id>`
- open vs code on it

you can run this again anytime to spin up another project.

## something went wrong?

- install issues: `tail -100 /tmp/if-install.log`
- new-project issues: `tail -100 /tmp/if-new.log`
- email [andrew@almostawake.com](mailto:andrew@almostawake.com) with what you saw

## what lives in this repo

- `scripts/` — install + new + helper shell scripts
- `client/` — the sveltekit dashboard template (cloned per-project)
- `functions/` — cloud functions template
- `CLAUDE-*.md` — agent instructions for claude code (modifying the template itself)

you don't need to read any of those to use the kit — the install and new scripts handle everything.
