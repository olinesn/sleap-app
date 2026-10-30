# Behavior Labeling

Label what your animals do: rearing, grooming, chasing. You choose the behaviors ahead of
time (an *ethogram*), then code them on the video with single keys.

Behavior labels are saved in the `.slp` file. [LUC3D](https://luc3d.sleap.ai) and Python
[sleap-io](https://io.sleap.ai) read and write the same data, so you can label in one tool,
open the file in another, and carry on.

## Set up your behaviors

Open the **Behavior** panel and click **Add**.

| Field | What it means |
|---|---|
| Name | What the behavior is called. Tools match behaviors across files by this name. |
| Key | One letter to press while coding. Digits are kept for picking animals. |
| Color | Its color on the timeline. |
| Length | **Has a start and an end** (grooming), or **One frame** (a bite). |
| Animals | **One animal**, **One animal to another** (chasing: has a target), or **A pair, no actor and target** (nose-to-nose). |
| Group | Behaviors in the same group exclude each other for one animal: labelling one over some frames clears the others there. |

## Code with keys

Click **Label behaviors** (++cmd+shift+l++ / ++ctrl+shift+l++). While it is on:

| Key | What it does |
|---|---|
| A behavior's letter | Starts a behavior, and stops it the next time. A one-frame behavior is labelled at once. |
| ++1++ … ++9++ | Picks the animal the keys label. If a behavior is waiting for its target, picks the target. |
| ++bracket-left++ then ++bracket-right++ | Marks a range: its start, then its end. You can also Shift+drag on the seekbar. |
| A behavior's letter, with a range selected | Labels the whole range. |
| ++shift++ + a behavior's letter, with a range selected | Labels the range as explicitly **not** that behavior. |
| ++esc++ | Cancels a waiting target, or leaves the mode. |

Everything else works as usual: arrow keys step through frames, and ++cmd+z++ / ++ctrl+z++
undoes a label. The top left of the video shows who you are labelling and what is running.
A behavior still running when you save is written up to the current frame, and keeps running.

The animals are the project's **identities** if it has any, otherwise its **tracks**.

## See and fix your labels

Under the seekbar, each behavior of each animal has its own row: a solid bar for a label, a
gray bar for a "not" label, a thin bar for a prediction. Click a row to go to that frame.

The panel lists the bouts on the video on screen. Click one to go to it, or use its buttons
to edit its frames and note, or delete it.

If you fix an identity switch by swapping two tracks from a frame onward (with **Propagate
Track Labels** on), the bouts on those tracks move with the animals.

## Review predictions

A file can hold predicted bouts: LUC3D's rule detectors and classifiers save them, and so can
your own scripts. They appear under **Predictions to review**, with where they came from and
their score. **Accept** labels those frames as the behavior, **Reject** labels them as not.
The prediction stays in the file, so its review shows as Accepted or Rejected.

## On several cameras

In a multi-camera project a bout belongs to the whole recording session: it shows on every
camera, whichever one you labelled it on. A clip you extract takes the bouts over its frames.

## In the file

Behaviors are sleap-io *events* (SLP format 2.6). In Python:

```python
import sleap_io as sio

labels = sio.load_slp("project.slp")
labels.event_types                     # the behaviors
labels.get_events(type="rear")         # every labelled and predicted rear
labels.events_at(labels.video, 120)    # what is happening at frame 120
```

Frames count from 0, and a bout's first and last frames are both included. A "not" label is
its own type (`not rear`), so counting `rear` never counts one. A bout's animal is its
`subject`, and a behavior's other animal its `target`.
