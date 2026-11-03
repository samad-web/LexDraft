package in.sirahdigital.difai;

import android.os.Build;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Keep case details out of the recent-apps thumbnail. Screenshots stay
        // allowed (advocates share cause lists), so not FLAG_SECURE.
        // shortcut: Android 12 and older still show the thumbnail; use FLAG_SECURE if that matters.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            setRecentsScreenshotEnabled(false);
        }
    }
}
