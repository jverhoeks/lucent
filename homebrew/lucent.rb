# Canonical Homebrew cask for Lucent.
#
# This file is the source of truth. The Release workflow fills in the version,
# sha256, and url placeholders from the published GitHub release and writes the
# result to Casks/lucent.rb in the jverhoeks/homebrew-tap repo. Do not hand-edit
# the copy in the tap — edit this one.
cask "lucent" do
  version "__VERSION__"
  sha256 "__SHA256__"

  url "__URL__"
  name "Lucent"
  desc "A clear, fast viewer for Markdown and structured text files"
  homepage "https://github.com/jverhoeks/lucent"

  app "Lucent.app"

  caveats <<~EOS
    Lucent is not yet signed with an Apple Developer certificate, so on first
    launch macOS Gatekeeper will refuse to open it. Clear the quarantine flag:

      xattr -cr /Applications/Lucent.app

    (Right-click → Open alone is often not enough on Apple Silicon.)
  EOS

  zap trash: [
    "~/Library/Application Support/com.lucent.viewer",
    "~/Library/Caches/com.lucent.viewer",
    "~/Library/Preferences/com.lucent.viewer.plist",
    "~/Library/Saved Application State/com.lucent.viewer.savedState",
  ]
end
