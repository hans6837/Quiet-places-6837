"""Unit tests for the Freesound metadata "listen-check".  Run: python3 -m unittest discover tests"""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import fetch_sounds as fs  # noqa: E402

CC0 = "http://creativecommons.org/publicdomain/zero/1.0/"
BY = "https://creativecommons.org/licenses/by/4.0/"
NC = "http://creativecommons.org/licenses/by-nc/4.0/"


def snd(name, tags, desc="", dur=120, lic=CC0):
    return dict(id=1, name=name, tags=tags, description=desc, duration=dur, license=lic, username="u",
                avg_rating=4, num_downloads=100)


class ListenCheck(unittest.TestCase):
    def ok(self, scene, s):
        return fs.check(s, fs.SCENES[scene])[0]

    def test_good_recordings_pass(self):
        self.assertTrue(self.ok("loons", snd("Common loon wail", ["loon", "lake"], dur=40)))
        self.assertTrue(self.ok("whales", snd("Humpback whale song", ["humpback", "hydrophone"])))
        self.assertTrue(self.ok("meadow", snd("White-throated Sparrow", ["bird"], dur=30)))
        self.assertTrue(self.ok("rocky-coast", snd("Surf on rocks", ["surf", "rocks"], lic=BY)))

    def test_licences(self):
        self.assertFalse(self.ok("loons", snd("Loon", ["loon"], lic=NC)))
        self.assertEqual(fs.licence(BY)[0], "CC BY 4.0")
        self.assertEqual(fs.licence(CC0)[0], "CC0 1.0")
        self.assertIsNone(fs.licence("https://creativecommons.org/licenses/sampling+/1.0/")[0])

    def test_human_noise_rejected(self):
        self.assertFalse(self.ok("sunset-beach", snd("Beach waves", ["beach", "waves", "voices"])))
        self.assertFalse(self.ok("forest-rain", snd("Rain on leaves", ["rain", "leaves"], "a car passes at 1:20")))
        self.assertFalse(self.ok("whales", snd("Whale song", ["whale", "song", "synth"])))
        self.assertFalse(self.ok("loons", snd("Loon", ["loon", "music"])))

    def test_negated_mentions_are_fine(self):
        self.assertTrue(self.ok("forest-stream", snd("Forest stream", ["stream", "forest"], "Recorded far away, no traffic and no people.")))

    def test_wrong_scene_rejected(self):
        self.assertFalse(self.ok("sunset-beach", snd("Waves on rocks", ["waves", "rocks", "beach"])))
        self.assertFalse(self.ok("forest-rain", snd("Rain on tin roof", ["rain", "roof", "forest"])))
        self.assertFalse(self.ok("lagoon", snd("Lake lapping at night", ["lapping", "lake", "night", "water"])))

    def test_duration(self):
        self.assertFalse(self.ok("loons", snd("Loon", ["loon"], dur=5)))
        self.assertFalse(self.ok("loons", snd("Loon", ["loon"], dur=900)))

    def test_groups_and_no_reuse(self):
        a = dict(snd("Chickadee", ["chickadee"]), id=1, username="a", _score=9, _text="chickadee")
        b = dict(snd("Chickadee 2", ["chickadee"]), id=2, username="b", _score=8, _text="chickadee")
        c = dict(snd("White-throated sparrow", ["zonotrichia"]), id=3, username="c", _score=1, _text="white-throated sparrow zonotrichia")
        picks = fs.choose([a, b, c], fs.SCENES["meadow"])
        self.assertIn(3, [p["id"] for p in picks])          # sparrow group represented despite low score
        picks = fs.choose([a, b, c, dict(a, id=4, username="d")], fs.SCENES["meadow"], used={1})
        self.assertNotIn(1, [p["id"] for p in picks])       # already used by another scene


if __name__ == "__main__":
    unittest.main()
