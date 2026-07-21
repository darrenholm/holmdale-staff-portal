package com.android.rockchip.dualscreendemo;

import android.app.ActivityOptions;
import android.app.Presentation;
import android.content.Context;
import android.content.Intent;
import android.hardware.display.DisplayManager;
import android.media.MediaRouter;
import android.support.v7.app.AppCompatActivity;
import android.os.Bundle;
import android.view.Display;
import android.view.View;
import android.widget.Button;

public class MainActivity extends AppCompatActivity {

    private Presentation presentation;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);
        Button btn1 = (Button)findViewById(R.id.btn_presentation_mediarouter);
        Button btn2 = (Button)findViewById(R.id.btn_presentation_displaymanager);
        Button btn3 = (Button)findViewById(R.id.btn_activity);
        btn1.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                if(presentation != null){
                    presentation.cancel();
                }
                showSecondByMediaRouter(MainActivity.this);
            }
        });
        btn2.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                if(presentation != null){
                    presentation.cancel();
                }
                showSecondByDisplayManager(MainActivity.this);
            }
        });
        btn3.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                if(presentation != null){
                    presentation.cancel();
                }
                showSecondByActivity(MainActivity.this);
            }
        });
    }

    private void showSecondByMediaRouter(Context context){
        MediaRouter mediaRouter = (MediaRouter) context.getSystemService(Context.MEDIA_ROUTER_SERVICE);
        MediaRouter.RouteInfo route = mediaRouter.getSelectedRoute(MediaRouter.ROUTE_TYPE_LIVE_VIDEO);
        if (route != null) {
            Display presentationDisplay = route.getPresentationDisplay();
            if (presentationDisplay != null) {
                presentation = new MyPresentation(context, presentationDisplay);
                presentation.show();
            }
        }
    }

    private void showSecondByDisplayManager(Context context) {
        DisplayManager mDisplayManager = (DisplayManager) getSystemService(Context.DISPLAY_SERVICE);
        Display[] displays = mDisplayManager.getDisplays(DisplayManager.DISPLAY_CATEGORY_PRESENTATION);
        if (displays != null) {
            presentation = new MyPresentation(context, displays[displays.length - 1]);
            presentation.show();
        }
    }

    private void showSecondByActivity(Context context){
        ActivityOptions options = ActivityOptions.makeBasic();
        MediaRouter mediaRouter = (MediaRouter) context.getSystemService(Context.MEDIA_ROUTER_SERVICE);
        MediaRouter.RouteInfo route = mediaRouter.getSelectedRoute(MediaRouter.ROUTE_TYPE_LIVE_VIDEO);
        if (route != null) {
            Display presentationDisplay = route.getPresentationDisplay();
            options.setLaunchDisplayId(presentationDisplay.getDisplayId());
            Intent intent = new Intent("android.intent.action.MUSIC_PLAYER");
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(intent, options.toBundle());
        }
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        if(presentation != null){
            presentation.cancel();
        }
    }
}
