// T0-4 alphaTab 드럼 트랙 추출 확인 (REQ-02 경로 C)
import * as alphaTab from "@coderline/alphatab";
import * as fs from "fs";

const fileData = await fs.promises.readFile(process.argv[2]);
const settings = new alphaTab.Settings();
const score = alphaTab.importer.ScoreLoader.loadScoreFromBytes(
  new Uint8Array(fileData),
  settings
);

console.log("title:", score.title);
console.log("tracks:", score.tracks.length);

for (const track of score.tracks) {
  console.log("--- track:", track.name, "| percussionArticulations.length:", track.percussionArticulations ? track.percussionArticulations.length : "N/A");
  console.log("playbackInfo:", JSON.stringify(track.playbackInfo));
  for (const staff of track.staves) {
    console.log("  staff isPercussion:", staff.isPercussion);
    for (const bar of staff.bars) {
      for (const voice of bar.voices) {
        for (const beat of voice.beats) {
          for (const note of beat.notes) {
            console.log(
              "    note: isPercussion=", note.isPercussion,
              "percussionArticulation=", note.percussionArticulation,
              "fret=", note.fret, "string=", note.string,
              "realValue=", typeof note.realValue === "function" ? note.realValue() : note.realValue
            );
          }
        }
      }
    }
  }
}
