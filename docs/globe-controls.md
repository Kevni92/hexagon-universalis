# North-up globe controls

`GlobeControls` stores geographic longitude and latitude rather than accumulating Euler angles.
Every frame composes two normalized quaternions: longitude around geographic north and latitude
around the east axis. There is no roll degree of freedom, so circular pointer paths cannot invert
the globe. Latitude defaults to ±85° and inertia is cancelled at a pole limit.

Pointer release starts an interruptible north-alignment phase. Because roll is eliminated
constructively during normal interaction, this phase normally converges immediately; its damping
remains centralized for imported or future animated orientations. Longitude, latitude, and camera
distance do not change during alignment.

The initial and minimum camera distances derive from sphere radius, relief reserve, and camera FOV.
For radius 1, 0.08 relief reserve, and 45° FOV the globe starts at roughly 2.82 units rather than
the previous fixed 3.4 units. The default near bound is 1.16 and the overview bound is eight
planet radii. Wheel and pinch inputs share these limits.
