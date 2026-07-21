package com.android.rockchip.dualscreendemo;

import android.app.Presentation;
import android.content.Context;
import android.os.Bundle;
import android.view.Display;

class MyPresentation extends Presentation {
    public MyPresentation(Context context, Display display) {
        super(context,display);
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.presentation);
    }
}
